## todo

- [x] Mass add relays by npub.
  - [x] Fetch a user's relay list from their npub.
  - [x] Add to current logged in user's relay list.
- [ ] Mass unfollow.
  - [ ] Allow a user to unfollow everyone they are following.
  - [ ] Provide a rollback function that refollows eveyrone in case of mistake.
- [ ] Mass follow by tag.
  - [ ] Enter a tag like `#nostr` and follow everyone who is associated with that tag.
- [x] Fetch user's relays to use for syncing.
  - [x] Add user's list of relays to our default list.
  - [x] Make sure failure to connect to a relay doesn't break the workflow. 
- [x] Add `<p class="ok">{successMessage}</p>` instead of `alert()`.
