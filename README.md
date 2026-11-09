# DiceSheet

A lightweight, Meteor-free character sheet that is compatible with DiceCloud
libraries, library collections and character files. It runs DiceCloud's own
rules engine (vendored from upstream `develop`), so sheets calculate the same
way, without Meteor or MongoDB.

Licensed GPL-3.0, derived from [DiceCloud](https://github.com/ThaumRystra/DiceCloud).

## What you get

- **One small container.** A ~2.6 MB app plus Node; one SQLite file holds everything.
  About 80 MB of memory idle, ~200–250 MB in use.
- **Your libraries, kept up to date.** Admin → Libraries → **Update all libraries**
  downloads the latest version of each library from dicecloud.com (public libraries, no
  login needed), keeping library and entry IDs so characters stay linked. Add more by
  pasting a dicecloud.com library link, or a whole collection by its `library-collection`
  link (dicecloud.com needs your login for that; it's used once, never saved). You can also
  upload a `mongoexport` `.tgz` or JSON. Collections can be edited on the same page.
- **Character files both ways.** Import any DiceCloud character archive (schema v1–v3).
  Export as this app's format, or **"for DiceCloud.com"** (schema v2), which your
  current DiceCloud server and dicecloud.com can restore.
- **Requirements that work.** Slot and level-up requirements (e.g. `showPHB2024`,
  `strength.value >= 13`) are checked against the fully calculated character, with the
  reason shown for anything unavailable. Unmet requirements block adding, unless you
  tick "Add even though requirements aren't met".
- **Per-character libraries.** Every library, one collection, or a hand-picked list.
- **DiceCloud's action engine.** Attack / Use / Cast run DiceCloud's own action engine:
  to-hit and damage rolls, uses and resources spent, spell slots, buffs, adjustments and
  triggers, with a prompt when an action needs a choice or advantage. Library setup steps
  (like LoV's "Assign Stats" for Standard Array) appear as a "finish setting up" panel.
- **Faster at the table.** HP bar with one-field Damage / Heal / Temp (temp HP absorb
  damage first), short and long rests (with rest triggers), quick roll buttons, uses and
  spell slots as pips, roll log in the Journal.
- **Custom changes.** Build → *Add a custom change* (or Tree → *Add custom*): a stat bonus
  (e.g. +5 max HP for the rest of the campaign, +1 AC, advantage on Stealth), a feature,
  a resource counter, a proficiency, a language or tool, an item or a note. They live in a
  "Custom" folder on the character and export with it.
- **Optional choices stay optional.** Slots DiceCloud marks as optional (e.g. Tutorial)
  don't count as choices to make, and any slot can be skipped.
- **Admin dashboard.** Open/close registration, add users, reset passwords,
  disable/delete, promote admins, character limit per user from **1 to 999**
  (there is no "unlimited"), default limit, rename library collections.
- **Plain username + password.** No Google/Patreon/Discord, no tabletop.

## Deploy with Docker

On the machine that runs Docker (e.g. your Proxmox container):

```sh
# 1. Copy the zip over and unpack it (run scp on your PC)
scp dicesheet-0.1.15.zip root@<server-ip>:/root/
ssh root@<server-ip>
cd /root && apt-get install -y unzip >/dev/null 2>&1; unzip -o dicesheet-0.1.15.zip && cd dicesheet

# 2. Build and start (first build takes a few minutes)
docker compose up -d --build

# 3. Get the one-time setup code
docker logs dicesheet
```

Open **http://<server-ip>:3100** and create your admin account with the setup code.

- To use a different port, change `"3100:3000"` in `docker-compose.yml` (the left number).
- Find the server's IP with `hostname -I`.
- If a firewall is on: `ufw allow 3100/tcp`.
- Plain `http://IP:port` is fine on your home network. Don't forward that port on your
  router to the internet; use the tunnel below for public access (it adds HTTPS).

### Updating to a new version

```sh
cd /root/dicesheet && docker compose up -d --build     # your data in ./data is kept
```

### First steps in the app

1. Open the site. It asks for the **setup code** from `docker logs dicesheet`, and
   you create your admin account. (Or set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in
   docker-compose.yml before the first start.)
2. **Admin → Libraries → Choose file**: upload `dicecloud-libraries.tgz`.
3. **Check the collection names.** In your export they are swapped: "Libraries Of Vexus
   (5e2014)" contains the 2024 libraries and "(5e2024)" the 2014 ones. Rename them there.
4. **Admin → Registration and limits**: registration starts **closed**. Set the default
   character limit (DiceCloud's default is 5).
5. Move characters over: in your current DiceCloud, archive/download each character,
   then here use **Import character file**.

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

### Checking dicecloud.com compatibility

`test/dicecloud-export.mjs` exports every character for dicecloud.com and runs each file through
DiceCloud master's own import checks and engine (needs a DiceCloud master checkout; see the
header of `harness/build-master.mjs`).

### Updating libraries

Admin → Libraries → **Update all libraries**. It takes a few minutes (it paces its requests
to stay under dicecloud.com's rate limit) and you can leave the page while it runs. A library
is only replaced once it has downloaded completely. Characters keep what they already have;
updated content is offered for new choices and level-ups. From the shell:

```sh
docker exec dicesheet node main.js sync-libraries https://dicecloud.com
# a whole collection (reads {"user": "...", "password": "..."} from stdin):
echo '{"user":"you@example.com","password":"..."}' | docker exec -i dicesheet \
  node main.js sync-libraries https://dicecloud.com --collection jp6xTaHDZK4ELYzvN --login-stdin
```

Adding a collection by link needs a DiceCloud.com account with an email or username and
password (DiceCloud only shows collections to logged-in users). The login goes straight to
DiceCloud.com for that download and isn't stored. The collection keeps its DiceCloud ID.

### Command line

```sh
docker exec dicesheet node main.js import-libraries /data/dicecloud-libraries.tgz
docker exec dicesheet node main.js create-admin <username> <password>
docker exec dicesheet node main.js set-registration open|closed
```

## Security

- Passwords hashed with scrypt; sessions are random tokens stored hashed, in
  HttpOnly, SameSite=Lax cookies (Secure behind Cloudflare), 30-day sliding expiry.
- Login rate limit per IP (`CF-Connecting-IP` with `TRUST_PROXY=cloudflare`) and per
  username; same response time for unknown users.
- Every state-changing request needs a custom header and a same-origin `Origin`, and
  no CORS is allowed, which blocks cross-site request forgery.
- Strict Content-Security-Policy; rules text is sanitized before display.
- Characters are private to their owner (and admins). The first admin needs the setup
  code from the server log, so nobody can claim a fresh public instance.

## Quick comment

I made DiceSheet out of frustration with trying to self-host my own DiceCloud server. Meteor ate up my storage and RAM, the UI didn’t always tell me what I needed to know, and getting it hosted at all was far more complicated than it should have been. On top of that, the community features just weren’t there on the self-hosted side. DiceSheet is my own solution to all of that.
