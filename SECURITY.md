# Security

Adamanteum desktop is a single-user app that listens on 127.0.0.1 only. Do not expose its port to a network.

- **Your notes stay on your computer.** The app reads and writes ordinary files in the folder you choose. It is read-only unless you set `ADAMANTIUM_VAULT_WRITE=1`. Back up a vault before you turn writing on.
- **No account, no cloud.** Nothing is sent anywhere unless you connect an AI provider yourself.
- **Your AI, your key.** You connect any OpenAI-compatible provider with your own endpoint, model and key. No key is bundled, inherited or used as a fallback. Keys stay in the running process only; connection-card downloads contain no keys; disconnect removes the connection.
- **Every AI goes through the door.** An AI gets in only with a key you mint (`read` or `write`), every call names its actor, and every call leaves a receipt.
- **Sharing needs your permission each time.** Documents, search excerpts, images and public URLs are shared per request. Image previews are resized locally and re-encoded to discard metadata.
- **Keep `.data` private.** It holds your source text, indices, local settings, cached code maps and door keys. Never publish it.
- **Imported code is parsed, never run.** Project scans skip hidden paths, symlinks and dependency folders. Syntax failures are reported, not guessed as links.
- **The optional assistant connection** to a hosting app is off by default. When switched on it uses that app's sign-in, explicit consent and a short-lived grant bound to one company.
- `tests/fixtures/test-only-key.pem` is a self-signed key for `localhost`, used only by the test suite. It protects nothing.

Report a security problem by opening a private security advisory on this repository.
