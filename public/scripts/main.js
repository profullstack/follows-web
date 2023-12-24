// parameters
const cacheRelayUrl = "wss://cache2.primal.net/v1"; // "wss://cache.follows.lol";
const defaultRelayList = ["wss://relay.primal.net", "wss://relay.follows.lol"];
const userFollowersLimit = 500;

// define our tools
const nt = window.NostrTools;

// reactivity
function disableButton() {
    document
        .getElementById('follow-button')
        .setAttribute('disabled', 'disabled');
}
function enableButton() {
    document
        .getElementById('follow-button')
        .removeAttribute('disabled');
}
// force firefox to disable button until connected
disableButton();

// print log to div
function print(msg, color) {
    const htmlLog = document.getElementById('html-log');
    if (color) {
        msg = `<a style="color:${color};">${msg}</a>`
    }
    // check what we need to output (object or text)
    // and add it to the html element.
    if (typeof msg == 'object') {
        htmlLog.innerHTML += (
            JSON && JSON.stringify ? JSON.stringify(msg) : msg
        ) + '<br>';
    } else {
        htmlLog.innerHTML += msg + '<br>';
    }
    // keep scroll down
    htmlLog.scrollTop = htmlLog.scrollHeight;
}

// read user's relay list if present
async function getRelays() {
    let relayList = defaultRelayList;
    if (window.hasOwnProperty('nostr')) {
        const userRelays = await window.nostr.getRelays();
        for (let r in Object.keys(userRelays)) {
            const relayUrl = Object.keys(userRelays)[r];
            const isWriteable = userRelays[relayUrl].write;
            if (isWriteable) {
                relayList.push(relayUrl);
            }
        }
    }
    return(relayList);
}

// connect to relays concurrently
async function connectRelays() {
    window.relays = [];
    // initialize cache relay connection
    window.cacheRelay = nt.relayInit(cacheRelayUrl);
    cacheRelay.on('connect', () => {
        print(`Connected to cache relay ${cacheRelay.url}`)
    })
    cacheRelay.on('error', () => {
        print(
            "Couldn't connect to cache server.\n" +
            "Please try reloading the page.", 'Red'
        );
        throw new TypeError(`Failed to connect to ${cacheRelay.url}`);
    })
    // handle regular relays
    print('Connecting to relays...');
    let promises = [cacheRelay.connect()];
    const relayList = await getRelays();
    let noRelayAvailable = true;
    for ( let r in relayList ) {
        // initialize relay connection
        const url = relayList[r];
        window.relays[r] = nt.relayInit(url);
        relays[r].on('connect', () => {
            print(`Connected to relay ${url}`);
            noRelayAvailable = false;
        });
        relays[r].on('error', () => {
            print(
                `Could not connect to relay ${url}.`,
                'DarkOrange'
            );
            // remove from global list
            relays.splice(r, 1);
        });
        // connect promise
        promises.push(relays[r].connect());
    }
    // concurrency
    await Promise.allSettled(promises);
    // stop if we got no relay
    if (noRelayAvailable) {
        print(
            `Could not connect to any regular relay.\n` +
            `Please try reloading the page.`,
            'Red'
        );
        throw new TypeError(`Failed to connect to relay(s).`);
    }
    // reactivity
    enableButton();
    print('Ready.');
}

function getFollowers(targetUserPubkey, success) {
    print(`Getting target user's followers...`);
    const filter = {
        "cache": [
            "user_followers",
            { "pubkey": targetUserPubkey, "limit": userFollowersLimit }
        ]
    }
    const sub = cacheRelay.sub([filter]);
    let followers = [];
    sub.on('event', event => {
        if (event.kind === 0) {
            followers.push(["p", event.pubkey]); // match contact list format
        }
    });
    sub.on('eose', () => {
        sub.unsub()
        print(`Target user's followers: ` + followers.length);
        success(followers);
    });
}
// wrap function above in a promise
function getFollowersPromise(targetUserPubkey) {
    return new Promise((result) => {
        getFollowers(targetUserPubkey, (success) => {
            result(success);
        })
    });
}

function getContactListEvent(userPubkey, label, success) {
    // the label should be either "own" or, for example,
    // "target user's"
    print(`Getting ${label} contact list...`);
    const filter = {
        "authors": [userPubkey],
        "kinds": [3],
        "limit": 1
    }
    const sub = relays[0].sub([filter]);
    sub.on('event', event => {
        let eventValidation = nt.verifySignature(event);
        if (eventValidation !== true) {
            throw new TypeError("We received a fake event!");
        } else {
            print(`Contact list size (${label}): ` + event.tags.length);
            success(event);
        }
    });
    sub.on('eose', () => {
        sub.unsub()
    });
}
// wrap function above in a promise
function getContactListEventPromise(userPubkey, label) {
    return new Promise((result) => {
        getContactListEvent(userPubkey, label, (success) => {
            result(success);
        })
    });
}

function getRelayListEvent(userPubkey, label, success) {
    // the label should be either "own" or, for example,
    // "target user's"
    print(`Getting ${label} relay list...`);
    const filter = {
        "authors": [userPubkey],
        "kinds": [10002],
        "limit": 1
    }
    const sub = relays[0].sub([filter]);
    sub.on('event', event => {
        let eventValidation = nt.verifySignature(event);
        if (eventValidation !== true) {
            throw new TypeError("We received a fake event!");
        } else {
            print(`Relay list size (${label}): ` + event.tags.length);
            success(event);
        }
    });
    sub.on('eose', () => {
        sub.unsub();
    });
}
// wrap function above in a promise
function getRelayListEventPromise(userPubkey, label) {
    return new Promise((result) => {
        getRelayListEvent(userPubkey, label, (success) => {
            result(success);
        })
    });
}

// merge lists of tags
function mergeLists(list1, list2) {
    const listSum = list1.concat(list2);
    let listSumPksOnly = [];
    listSum.forEach((i) => { // simplify list format
        listSumPksOnly.push(i[0] + '_' + i[1]);
    });
    let uniqPksOnly = [...new Set(listSumPksOnly)]; // uniq values
    let result = [];
    uniqPksOnly.forEach((i) => {
        let tag = i.substring(0, 1);
        let value = i.substring(2);
        result.push([tag, value]); // restore original format
    });
    return(result);
}

// sign according to either extension or manual private key mode
async function signEvent(userPrivateKey, event) {
    try {
        if (!window.nostr) {
            // nsec mode
            newEvent.sig = nt.getSignature(event, userPrivateKey);
            return(event);
        } else {
            // extension mode
            return(await window.nostr.signEvent(event));
        }
    } catch (e) {
        print(e, 'DarkRed');
        print(`Please reload and try again.`, 'DarkRed');
        throw new TypeError(e);
    }
}

// if there is no browser extension present, activate nsec input field
function checkExtensionPresence() {
    if (!window.hasOwnProperty('nostr')) { // no browser extension detected
        console.log('No Nostr browser extension detected.');
        document
            .getElementById('nsec-field')
            .setAttribute('class', 'field');
        window.alert(
            `We were unable to detect a Nostr browser extension.\n` +
            `We just added a field for you to manually enter your private key, which ` +
            `is then stored locally in your browser (it is never sent to us).\n` +
            `Use this option only if you know what you're doing.\n` +
            `If you don't, it is best for you to first get a ` +
            `Nostr browser extension, for example from https://GetAlby.com`
        );
    }
}

// make sure everything is loaded before starting
document.onreadystatechange = () => {
    if (document.readyState === "complete") {
        console.info("Loading complete.");
        // go go go
        checkExtensionPresence();
        connectRelays();
    }
};

async function propagate(event) {
    let promises = [];
    for (let r in relays) {
        promises.push(relays[r].publish(event));
    }
    let statuses = await Promise.allSettled(promises);
    let result = false;
    for (let s in statuses) {
        if (statuses[s].status === "fulfilled") {
            result = true;
        } else {
            print(`Error publishing to relay ${s}.`, 'DarkRed');
        }
    }
    return(result);
}

// main function
async function onSubmit(e) {
    // reactivity stuff
    e.stopImmediatePropagation();
    e.preventDefault();
    disableButton();

    // prepare to get target data
    const targetUserNpub = document.getElementById('npub').value.trim();
    const targetUserPubkey = nt.nip19.decode(targetUserNpub).data;

    // prepare to get user's data
    const wn = window.nostr;
    const userNsec = wn ? null : document.getElementById('nsec').value;
    const userPrivateKey = wn ? null : nt.nip19.decode(userNsec).data;
    const userPubkey = wn ? await wn.getPublicKey() : nt.getPublicKey(userPrivateKey);

    // prepare promises for concurrent fetching of data
    const promises = [
        getContactListEventPromise(userPubkey, "own"),
        getContactListEventPromise(targetUserPubkey, "target user's"),
        getFollowersPromise(targetUserPubkey),
    ];
    const relaysCheckbox = document.getElementById('aggregate-relays-checkbox').checked;
    if (relaysCheckbox) {
        promises.push(
            getRelayListEventPromise(userPubkey, "own"),
            getRelayListEventPromise(targetUserPubkey, "target user's")
        );
    }

    // get data concurrently
    const allPromiseStatuses = await Promise.allSettled(promises);
    const contactListEvent = allPromiseStatuses[0].value; // ours
    const contactList = contactListEvent.tags; // ours
    const targetContactList = allPromiseStatuses[1].value.tags;
    const targetFollowers = allPromiseStatuses[2].value;

    // never accidentally remove contacts
    if ( !contactList > 0 ) {
        print(
            `Could not read contact list for pubkey "${userPubkey}".\n` +
            `Please try again refreshing the page.`
        );
        throw new TypeError(`Could not read current contact list.`);
    }

    // merge the three contact lists
    print('Consolidating contact lists...');
    const targetList = mergeLists(targetFollowers, targetContactList);
    const newList = mergeLists(targetList, contactList);
    print('Making new contact list: ' + newList.length);

    // calculate how many new contacts
    const diff = newList.length - contactList.length;
    if (diff > 0) { // never accidentally remove contacts
        print(`Adding ${diff} new contacts...`, 'DarkOrange');

        // work on new contact list event
        let newEvent = contactListEvent;
        newEvent.created_at = Math.floor(Date.now() / 1000);
        newEvent.tags = newList;
        newEvent.id = nt.getEventHash(newEvent);

        // sign the new event
        const signedEvent = await signEvent(userPrivateKey, newEvent);

        // propagate
        const propagationResult = await propagate(signedEvent);
        if (propagationResult) {
            print(`Event published, contact list updated.`);
            print(`<b>Success! Now you follow ${diff} new people.</b>`, 'Green');
        } else {
            print(`Sorry, we couldn't update your contact list.`, 'DarkRed');
        }
    } else {
        print("Sorry, we couldn't find any new people to follow.", 'DarkRed');
    }

    // user asked us to work on relays too
    if (relaysCheckbox) {
        const relayListEvent = allPromiseStatuses[3].value; // ours
        const relayList = relayListEvent.tags; // ours
        const targetRelayList = allPromiseStatuses[4].value.tags;

        // merge both relay lists
        print('Consolidating relay lists...');
        const newRelayList = mergeLists(targetRelayList, relayList);
        print('Making new relay list: ' + newRelayList.length);

        // work on new relay list event
        let newEvent = relayListEvent;
        newEvent.created_at = Math.floor(Date.now() / 1000);
        newEvent.tags = newRelayList;
        newEvent.id = nt.getEventHash(newEvent);

        // calculate how many new relays
        const rdiff = newRelayList.length - relayList.length;
        if (rdiff > 0) { // never accidentally remove relays
            print(`Adding ${rdiff} new relays...`, 'DarkOrange');
            // sign the new event
            const signedEvent = await signEvent(userPrivateKey, newEvent);
            // propagate
            const propagationResult = await propagate(signedEvent);
            if (propagationResult) {
                print(`Event published, relay list updated.`);
                print(`<b>Success! Now you have ${rdiff} more relays.</b>`, 'Green');
            } else {
                print(`Sorry, we couldn't update your relay list.`, 'DarkRed');
            }
        } else {
            print("Sorry, we couldn't find any new relays.");
        }
    }

    // reactivity
    enableButton();
}
document.getElementById('follow-form').addEventListener('submit', onSubmit);

