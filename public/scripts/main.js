// parameters
const cacheRelayUrl = "wss://cache2.primal.net/v1";
//const cacheRelayUrl = "wss://cache.follows.lol";
const defaultRelayUrl = "wss://nos.lol";
const userFollowersLimit = 999;

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

// set connection to cache relay
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

// set connection to default relay
window.relay = nt.relayInit(defaultRelayUrl);
relay.on('connect', () => {
    print(`Connected to default relay ${relay.url}`)
})
relay.on('error', () => {
    print(
        "Couldn't connect to default relay.\n" +
        "Please try reloading the page.", 'Red'
    );
    throw new TypeError(`Failed to connect to ${cacheRelay.url}`);
})

async function connectRelays() {
    print('Connecting to relays...');
    await Promise.allSettled(
        [
            relay.connect(),
            cacheRelay.connect()
        ]
    );
    // enable form button
    enableButton();
}
// connect to relays
await connectRelays();

function getTargetFollowers(targetUserPubkey, success) {
    print('Getting target followers...');
    let filter = {
        "cache": [
            "user_followers",
            { "pubkey": targetUserPubkey, "limit": userFollowersLimit }
        ]
    }
    let sub = cacheRelay.sub([filter]);
    let followers = [];
    sub.on('event', event => {
        if (event.kind === 0) {
            followers.push(["p", event.pubkey]); // match contact list format
        }
    });
    sub.on('eose', () => {
        sub.unsub()
        print('Target followers: ' + followers.length);
        success(followers);
    });
}
// wrap function above in a promise
function getTargetFollowersPromise(targetUserPubkey) {
    return new Promise((result) => {
        getTargetFollowers(targetUserPubkey, (success) => {
            result(success);
        })
    });
}

function getContactListEvent(userPubkey, label, success) {
    // the label should be either "own" or, for exmaple, 
    // "target user's"
    print(`Getting ${label} contact list...`);
    let filter = {
        "authors": [userPubkey],
        "kinds": [3],
        "limit": 1
    }
    let sub = relay.sub([filter]);
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

function mergeLists(list1, list2) {
    let listSum = list1.concat(list2);
    let listSumPksOnly = [];
    listSum.forEach((i) => { // simplify list format
        listSumPksOnly.push(i[1]);
    });
    let uniqPksOnly = [...new Set(listSumPksOnly)]; // uniq values
    let result = [];
    uniqPksOnly.forEach((i) => {
        result.push([ "p", i ]); // restore original format
    });
    return(result);
}

// sign according to either extension or manual private key mode
async function signEvent(userPrivateKey, event) {
    let signedEvent = null;
    if (!window.nostr) {
        // nsec mode
        newEvent.sig = nt.getSignature(event, userPrivateKey);
        signedEvent = event;
    } else {
        // extension mode
        signedEvent = await window.nostr.signEvent(event);
    }
    return(signedEvent);
}

// if there is no browser extension present, activate nsec input field
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
        `Nostr browser extension, for example from https://GetAlby.com`);
}

// main function
async function onSubmit(e) {
    // reactivity stuff
    e.stopImmediatePropagation();
    e.preventDefault();
    disableButton();

    // prepare to get target data
    let targetUserNpub = document.getElementById('npub').value.trim();
    let targetUserPubkey = nt.nip19.decode(targetUserNpub).data;

    // prepare to get user's data
    let userPubkey, userNsec, userPrivateKey = null;
    if (window.nostr) {
        userPubkey = await window.nostr.getPublicKey();
    } else {
        userNsec = document.getElementById('nsec').value;
        userPrivateKey = nt.nip19.decode(userNsec).data;
        userPubkey = nt.getPublicKey(userPrivateKey);
    }

    // get data concurrently
    let allPromiseStatuses = await Promise.allSettled([
        getContactListEventPromise(userPubkey, "own"), // ours
        getContactListEventPromise(targetUserPubkey, "target user's"),
        getTargetFollowersPromise(targetUserPubkey)
    ]);
    let contactListEvent = allPromiseStatuses[0].value; // ours
    let contactList = contactListEvent.tags; // ours
    if ( !contactList > 0 ) { // never accidentally remove contacts
        throw new TypeError(`Could not read current contact list.`);
        print(
            `Could not read contact list for pubkey "${userPubkey}".\n` +
            `Please try again refreshing the page.`
        );
    }
    let targetContactList = allPromiseStatuses[1].value.tags;
    let targetFollowers = allPromiseStatuses[2].value;

    // merge the three lists
    print('Consolidating lists...');
    let targetList = mergeLists(targetFollowers, targetContactList);
    let newList = mergeLists(targetList, contactList);
    print('Making new contact list: ' + newList.length);

    // work on new event
    let newEvent = contactListEvent;
    newEvent.created_at = Math.floor(Date.now() / 1000);
    newEvent.tags = newList;
    newEvent.id = nt.getEventHash(newEvent);

    // calculate how many new contacts
    let diff = newList.length - contactList.length;
    if (diff > 0) { // never accidentally remove contacts
        print(`Adding ${diff} new contacts...`, 'DarkOrange');
        // sign the new event
        let signedEvent = await signEvent(userPrivateKey, newEvent);
        try {
            // propagate
            await relay.publish(signedEvent);
            print('Event published, contact list updated.');
            print(`<b>Success! Now you follow ${diff} new people.</b>`, 'Green');
        } catch (error) {
            throw new TypeError(error);
        }
    } else {
        print("Sorry, we couldn't find any new people to follow.", 'DarkRed');
    }
    enableButton();
}
document.getElementById('follow-form').addEventListener('submit', onSubmit);

