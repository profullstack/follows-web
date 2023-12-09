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

// print console.log to div
function print(msg) {
    var htmlLog = document.getElementById('html-log');
    // check what we need to output (object or text) and add it to the html element.
    if (typeof msg == 'object') {
        htmlLog.innerHTML += (JSON && JSON.stringify ? JSON.stringify(msg) : msg) + '<br>';
    } else {
        htmlLog.innerHTML += msg + '<br>';
    }
}

// set connection to cache relay
window.cacheRelay = nt.relayInit('wss://cache2.primal.net/v1')
cacheRelay.on('connect', () => {
    print(`Connected to ${cacheRelay.url}`)
})
cacheRelay.on('error', () => {
    console.log(`Failed to connect to ${cacheRelay.url}`)
    window.alert("Couldn't connect to the cache server. Try reloading the page.")
})

// set connection to relay
window.relay = nt.relayInit('wss://relay.primal.net/')
relay.on('connect', () => {
    print(`Connected to ${relay.url}`)
})
relay.on('error', () => {
    console.log(`Failed to connect to ${relay.url}`)
    window.alert("Couldn't connect to the relay. Try reloading the page.")
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
            { "pubkey": targetUserPubkey }
        ]
    }
    let sub = cacheRelay.sub([filter]);
    var followers = []
    sub.on('event', event => {
        followers.push(["p", event.pubkey]); // match contact list format
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
    sub.on('eose', () => {
        sub.unsub()
    });
    sub.on('event', event => {
        let eventValidation = nt.verifySignature(event);
        if (eventValidation !== true) {
            throw new TypeError("We received a fake event!");
        } else {
            print(`Contact list size (${label}): ` + event.tags.length);
            success(event);
        }
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

if (!window.hasOwnProperty('nostr')) { // no browser extension detected
    console.log('No Nostr browser extension detected.');
    document
        .getElementById('nsec-field')
        .setAttribute('class', 'field');
    window.alert(
        `We were unable to detect a Nostr browser extension.\n` +
        `We added a field so that you can manually enter your private key.\n` +
        `Use this option only if you know what you're doing.\n` +
        `If you don't, it is best for you to first get a ` +
        `Nostr browser extension, for example from https://getalby.com`);
}

// main function
async function onSubmit(e) {
    e.stopImmediatePropagation();
    e.preventDefault();
    disableButton();

    // prepare to get target data
    let targetUserNpub = document.getElementById('npub').value;
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
        getTargetFollowersPromise(targetUserPubkey),
        getContactListEventPromise(userPubkey, "own"),
        getContactListEventPromise(targetUserPubkey, "target user's")
    ]);
    let targetFollowers = allPromiseStatuses[0].value;
    let contactListEvent = allPromiseStatuses[1].value;
    let contactList = contactListEvent.tags;
    let targetContactList = allPromiseStatuses[2].value.tags;

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

    // sign the new event
    let signedEvent = null;
    if (!window.nostr) {
        // nsec mode
        newEvent.sig = nt.getSignature(newEvent, userPrivateKey);
        signedEvent = newEvent;
    } else {
        // extension mode
        signedEvent = await window.nostr.signEvent(newEvent);
    }

    // propagate
    try {
        await relay.publish(signedEvent);
        print('Event published, contact list updated.');
        let diff = newList.length - contactList.length;
        window.alert(
        `Done!\nNow you follow ${diff} new people.`);
    } catch (error) {
        throw new TypeError(error);
    }
    enableButton();
}
document.getElementById('follow-form').addEventListener('submit', onSubmit);

