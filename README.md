# DiceSheet

A lightweight, Meteor-free character sheet that is compatible with DiceCloud
libraries, library collections and character files. It runs DiceCloud's own
rules engine (vendored from upstream `develop`), so sheets calculate the same
way, without Meteor or MongoDB.

Licensed GPL-3.0, derived from [DiceCloud](https://github.com/ThaumRystra/DiceCloud).
DiceSheet is an independent project and isn't affiliated with DiceCloud.

## What you get

- **One small container.** A ~2.6 MB app plus Node; one SQLite file holds everything.
  About 80 MB of memory idle, ~200–250 MB in use.
- **Libraries from export files.** Admin → Libraries → **Import libraries** takes a
  DiceCloud library export: the `.tgz` made with `mongoexport`, or `.json`/`.jsonl` files.
  Library and entry IDs are kept, so characters stay linked. DiceSheet never downloads or
  updates libraries on its own; to update one, import a newer export of it. Collections
  in the file come along and can be edited on the same page.
- **Character files both ways.** Import any DiceCloud character archive (schema v1–v3).
  Export as this app's format, or **"for DiceCloud.com"** (schema v2), which a
  DiceCloud server and dicecloud.com can restore.
- **Requirements that work.** Slot and level-up requirements (e.g. `showPHB2024`,
  `strength.value >= 13`) are checked against the fully calculated character, with the
  reason shown for anything unavailable. Unmet requirements block adding, unless you
  tick "Add even though requirements aren't met".
- **Per-character libraries.** Every library, one collection, or a hand-picked list.
- **DiceCloud's action engine.** Attack / Use / Cast run DiceCloud's own action engine:
  to-hit and damage rolls, uses and resources spent, spell slots, buffs, adjustments and
  triggers, with a prompt when an action needs a choice or advantage. Library setup steps
  (like a "Standard Array" stat assignment) appear as a "finish setting up" panel.
- **Faster at the table.** HP bar with one-field Damage / Heal / Temp (temp HP absorb
  damage first), short and long rests (with rest triggers), quick roll buttons, uses and
  spell slots as pips, roll log in the Journal.
- **Custom changes.** Build → *Add a custom change* (or Tree → *Add custom*): a stat bonus
  (e.g. +5 max HP for the rest of the campaign, +1 AC, advantage on Stealth), a feature,
  a resource counter, a proficiency, a language or tool, an item or a note. They live in a
  "Custom" folder on the character and export with it.
- **Optional choices stay optional.** Slots DiceCloud marks as optional (e.g. Tutorial)
  don't count as choices to make, and any slot can be skipped.
- **Character folders and printing.** Sort characters into folders, and print any sheet
  (or save it as a PDF) on a two-page layout modeled on the 2024 character sheet.
- **Admin dashboard.** Open/close registration, add users, reset passwords,
  disable/delete, promote admins, character limit per user from **1 to 999**
  (there is no "unlimited"), default limit, rename library collections, and a live log.
- **Plain username + password.** No Google/Patreon/Discord, no tabletop.

## Deploy with Docker

On the machine that runs Docker:

```sh
# 1. Get the code (or download the source zip from the Releases page and unzip it)
git clone https://github.com/<your-github-user>/dicesheet.git
cd dicesheet

# 2. Build and start (first build takes a few minutes)
docker compose up -d --build

# 3. Get the one-time setup code
docker logs dicesheet
```

Open **http://<server-ip>:3100** and create your admin account with the setup code.

- To use a different port, change `"3100:3000"` in `docker-compose.yml` (the left number).
- Find the server's IP with `hostname -I`.
- If a firewall is on: `ufw allow 3100/tcp`.
- Set `TZ` in `docker-compose.yml` to your time zone (used for log times).
- Plain `http://IP:port` is fine on your home network. Don't forward that port on your
  router to the internet; for public access put it behind something that adds HTTPS, such
  as a Cloudflare Tunnel or a reverse proxy. With Cloudflare, also set
  `TRUST_PROXY: cloudflare` so sign-in rate limits see the real visitor IP.

### Updating to a new version

```sh
cd dicesheet && git pull && docker compose up -d --build     # your data in ./data is kept
```

### First steps in the app

1. Open the site. It asks for the **setup code** from `docker logs dicesheet`, and
   you create your admin account. (Or set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in
   docker-compose.yml before the first start.)
2. **Admin → Libraries → Import libraries → Choose file**: upload your library export.
3. **Check the collections** on the same page. They're shown with their libraries, so you
   can rename them or change what they contain.
4. **Admin → Registration and limits**: registration starts **closed**. Set the default
   character limit (DiceCloud's default is 5).
5. Move characters over: in DiceCloud, archive/download each character, then here use
   **Import character file**.

### Libraries

DiceSheet doesn't include any libraries and doesn't fetch them from anywhere. You bring
your own export from a DiceCloud server you run or have access to. Importing a library
that's already there replaces it, keeping its IDs: characters keep what they already took
from it, and the new content is offered for later choices and level-ups. Removing a library
doesn't change existing characters either.

### Character folders

On **Your characters**, **New folder** makes a folder (e.g. one per campaign). Drag a character
onto a folder, or pick one from the menu on its card. Click a folder's name to collapse it.
Folders are private to each player, and deleting a folder never deletes its characters; they
move back to the main list.

### Printing a character

On a character sheet, **Print / PDF** opens a printable version laid out for Letter paper
(8.5 × 11 in), modeled on the 2024 two-page sheet. Page 1 has abilities, skills, combat,
weapons and features; page 2 has spellcasting, appearance, personality, equipment and coins.
Anything that doesn't fit, plus the full text of every feature (optional), continues on extra
pages. Print it, or choose **Save as PDF** in the print dialog. The PDF is made by your browser,
so the server stays small.

### Serving DiceSheet from another address

DiceSheet only accepts sign-ins and changes from the address it's opened on. If it's also served
through another address (a Cloudflare Worker, a second domain), sign-in there fails with
"Cross-origin request blocked". Add that address under **Admin → Registration and limits →
Other addresses**, or set `ALLOWED_ORIGINS` (comma-separated) in `docker-compose.yml`:

```
https://dicesheet.yourname.workers.dev
https://*.yourdomain.com           # every subdomain of a domain you own
```

Wildcards on shared hosts (`*.workers.dev`, `*.pages.dev`…) are refused, because anyone can
create addresses there.

### Logs

**Admin → Logs** shows the server's log live: sign-ins (and failed attempts), admin changes,
library imports, warnings and errors, with filters, search and download. The same lines go to
`docker logs dicesheet`.

### Backups

Everything lives in `./data/dicesheet.db`. To take a safe copy while it runs:

```sh
docker exec dicesheet node main.js backup /data/backup.db
```

### Command line

```sh
docker exec dicesheet node main.js import-libraries /data/<your-library-export>.tgz
docker exec dicesheet node main.js create-admin <username> <password>
docker exec dicesheet node main.js set-registration open|closed
docker exec dicesheet node main.js backup /data/backup.db
```

## Security

- Passwords hashed with scrypt; sessions are random tokens stored hashed, in
  HttpOnly, SameSite=Lax cookies (Secure behind HTTPS), 30-day sliding expiry.
- Login rate limit per IP (`CF-Connecting-IP` with `TRUST_PROXY=cloudflare`) and per
  username; same response time for unknown users.
- Every state-changing request needs a custom header and an `Origin` that is either the
  site itself or one of the admin-approved other addresses, which blocks cross-site request
  forgery. CORS is only sent to those approved addresses.
- Strict Content-Security-Policy; rules text is sanitized before display.
- Characters are private to their owner (and admins). The first admin needs the setup
  code from the server log, so nobody can claim a fresh public instance.

## Not yet included

- **Targeting other creatures.** Actions run on your own character; damage to a target is
  rolled and logged, and you apply it to the other sheet by hand.
- The full per-type **property editor**. You can edit names, text and every formula,
  remove, restore and add notes, but there's no form yet for creating any property type.
- Sharing characters with other users, and editing libraries in the app (edit them in
  DiceCloud and import a new export).

## Development

```sh
npm install
npm run build                      # server -> dist/main.js, web -> dist/web
DATA_DIR=./data npm start          # http://localhost:3000
npm run dev:web                    # UI dev server
node test/folders.mjs http://localhost:3000 <admin> <password>   # also test/logs.mjs, test/origins.mjs
```

Layout: `vendor/imports` = DiceCloud source (edits listed in `PATCHES.md`),
`shim/` = Meteor stand-ins, `src/engine` = engine API, `src/server` = HTTP + SQLite,
`web/` = Vue 3 UI.

## Quick comment

I made DiceSheet out of frustration with trying to self-host my own DiceCloud server. Meteor ate up my storage and RAM, the UI didn’t always tell me what I needed to know, and getting it hosted at all was far more complicated than it should have been. On top of that, the community features just weren’t there on the self-hosted side. DiceSheet is my own solution to all of that.