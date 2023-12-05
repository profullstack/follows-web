// Your Nostr private key
//const privateKey = 'your_private_key'; // Replace with your actual private key

// Function to get followers for a given npub
async function getAndFollowUsersFollowers(targetNpub) {
    //const { relayInit, finishEvent, generatePrivateKey, getPublicKey } = window.nostr;
    const relayUrl = 'wss://relay.primal.net'; // Replace with your chosen relay URL
    const client = new nostr.Client();

    // Connect to the relay
    await client.connect(relayUrl);

    // Subscription to get 'meta' events
    const subscription = {
        filter: {
            kinds: [4], // Kind 4 for 'meta' events
            authors: [targetNpub] // The npub of the target user
        },
        cb: (event) => {
            // Handle the event - extract followers
            if (event.content && event.content.follow) {
                event.content.follow.forEach(async (followerNpub) => {
                    // Follow each follower
                    await followUser(followerNpub, client);
                });
            }
        }
    };

    client.subscribe(subscription);
}

// Function to follow a user
async function followUser(followerNpub, client) {
    const { pubkey } = (await window.webln.getInfo()).node;
    const pubkey2 = await window.nostr.getPublicKey();
    const event = {
        pubkey,
        kind: 4, // Kind 4 for 'meta' events
        content: {
            follow: [followerNpub]
        },
        tags: [],
        created_at: Math.floor(new Date().getTime() / 1000),
    };

          // Sign the event with your private key
      		async window.nostr.signEvent(event); // takes an event object, adds `id`, `pubkey` and `sig` and returns it
    // event.id = nostr.getEventId(event, privateKey);
    //event.sig = nostr.getEventSignature(event, privateKey);

    // Publish the event
    await client.publish(event);
}

async function createInvoiceAndPay() {
    if (typeof window.webln === 'undefined') {
        return;
    }

    await window.webln.enable();
    const res = await fetch('https://globalthreat.info/api/payments/invoice', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            description: 'get my follow on at follows.lol!'
        })
    });

    const invoice = await res.json();

    const result = await webln.lnurl('zap@pay.globalthreat.info');

    console.log(result);
}

async function onSubmit(e) {
    e.preventDefault();
    const targetUserNpub = document.getElementById('npub').value;

    getAndFollowUsersFollowers(targetUserNpub);
}

window.addEventListener('DOMContentLoaded', function () {
    console.log('Loaded!');
    document.getElementById('follow').addEventListener('submit', onSubmit);
});