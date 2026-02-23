# Oh... Uh... Hello

There's really not much here - the API is intentionally sparse. There's really only one endpoint in the traditional "RESTful" API definition: `/` (yeah, it's just a slash)

## What Is The Point

I wanted a way to move between TUI and Web at the end of my work day, then back the next morning. So I built this.

## But Why The Encryption?

Because if I did it any other way, I'd have to worry about COPPA and PII and PHI and GDRP and whatever else. I don't **WANT** your data. I **WANT** _YOU_ to have it, though, and I wanted to make it easy for you to move between systems, too.

## The Root API

POST - Upserts (Updates or Inserts) a new save file for {encrypted_id}
  - If this is an Update, the endpoint expects the eTag provided by the GET to avoid unintentional overwrites
  - Has a rate limit of 4/hour.
GET - Retrieves the data for an {encrypted_id}
  - Also includes an eTag header that's a hash of the file to prevent unintentional overwrites
HEAD - Checks the last_updated timestamp for an {encrypted_id}
  - Basically a sanity check that an {encryption_id} is recognized

## How Do I Decrypt The Data

Well, unless you're the one who encrypted it, you don't. The server offers HTTPS connections, but even if it didn't, the data is encrypted before it leaves the user's device using an encryption method where:

1. The User's device combines the `username` and `passphrase` into a single string
2. The User's device generates an encryption key from that string
3. The User's device encrypts a super-duper-secret string ('the_answer_is_42') to generate the {encrypted_id}
    a. Honestly, though, you could even change this in your own copy of the code, just so long as you always encrypt the same string so your {encrypted_id} matches each time
4. The User's device encrypts their data with the key
5. The User's device calls POST /{encryption_id} with the data

So, even if I **could** somehow decode the ID, it would always just be "the_answer_is_42", and then I'd have to figure out how to decode the _actual data_ without knowing the key.

In other words, I have no idea who my users are; that's sort of the point.
