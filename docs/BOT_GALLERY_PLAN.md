# Bot gallery and bot cards: plan

Decisions from Atakan, 2026-10-30.

## What it is
A public showcase of bots people make in Nakata, like the GPT Store or
Character.AI. You publish a bot (name, instructions, description, a first
message); others find it in the gallery (categories, top, new, search) and
chat with it. Each bot has a share link.

## Bot cards (Atakan: "Pokémon kartları gibi", mascots must be eye-catching)
- Each published bot is a collectible **card**: its own mascot art, name,
  category, one-line description, stats (chats, likes), and a rarity frame
  earned by popularity (common, rare, epic, legendary).
- Mascot art: generated from the bot's description with our image models in
  the Nakata style (the desktop orb family as the house look, one character
  per bot), not a plain coloured orb. Creator can regenerate; first one free.
- Collecting: users keep the cards of bots they use or like in a deck.
- Selling like cards: the owner can sell a bot (unlock for credits) or issue
  a limited edition (numbered copies). Trading between users and random packs
  come later; packs would need Apple's odds disclosure (3.1.1) and loot-box
  rules, so not in v1.

## Money
- Owner share: **20%** of the **purchased** credits spent on their bot
  (free-tier chats earn nothing; self-use does not count; shares wait a few
  days and are clawed back if usage is faked).
- Paid as **Nakata credits first**; cash payouts (Stripe Connect or similar,
  identity + tax) once the gallery has volume.
- Credits are bought with Apple in-app purchase (needs Atakan's App Store
  Connect steps: Paid Apps Agreement, bank + tax, Small Business Program).

## v1 scope
1. Publish / unpublish a bot; gallery list (categories, top, new, search);
   share link; chat with a gallery bot.
2. Bot cards with generated mascot art and rarity frame.
3. Usage and likes counters; owner share ledger in credits (20%).
4. Apple 1.2 user-generated content: report a bot, block a creator, screen
   instructions before publishing; admin panel queue to review and remove.
Later: cash payouts, paid unlocks and limited editions, trading, packs,
people messaging each other.

## Where it plugs in
- Server: nakata.app worker (~/Projects/Database), new routes under
  /api/mobile/bots*, data in KV + CreditCounter (share ledger), art in R2.
- App: bots already exist locally (nakata_byok_bots); gallery adds a
  "Keşfet" page, card component, publish flow in the bot form.
