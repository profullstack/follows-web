// define our tools
const nt = window.NostrTools;

// button reactivity
function disableButton() {
    document
        .getElementById('follow-button')
        .setAttribute('disabled', 'true');
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
    print('Connecting relays...');
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

function getContactListEvent(userPubkey, success) {
    print('Getting own contact list...');
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
            print("Our current contact list: " + event.tags.length);
            success(event);
        }
    });
}
// wrap function above in a promise
function getContactListEventPromise(userPubkey) {
    return new Promise((result) => {
        getContactListEvent(userPubkey, (success) => {
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

// main function
async function onSubmit(e) {
    e.stopImmediatePropagation();
    e.preventDefault();
    disableButton();

    // prepare to get target data
    let targetUserNpub = document.getElementById('npub').value;
    let targetUserPubkey = nt.nip19.decode(targetUserNpub).data;

    // prepare to get user's data
    let userNsec = document.getElementById('nsec').value;
    let userPrivateKey = nt.nip19.decode(userNsec).data;
    let userPubkey = nt.getPublicKey(userPrivateKey);

    // get data concurrently
    let allPromiseStatuses = await Promise.allSettled([
        getTargetFollowersPromise(targetUserPubkey),
        getContactListEventPromise(userPubkey)
    ]);
    let targetFollowers = allPromiseStatuses[0].value;
    let contactListEvent = allPromiseStatuses[1].value;
    let contactList = contactListEvent.tags;

    // merge both lists
    let newList = mergeLists(targetFollowers, contactList);
    print('New contact list: ' + newList.length);

    // work on new event
    let newEvent = contactListEvent;
    newEvent.created_at = Math.floor(Date.now() / 1000);
    newEvent.tags = newList;
    newEvent.id = nt.getEventHash(newEvent);

    // sign the new event
    newEvent.sig = nt.getSignature(newEvent, userPrivateKey);

    // propagate
    try {
        await relay.publish(newEvent);
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

