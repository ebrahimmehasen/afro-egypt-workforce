---
name: run-app
description: Launch the Afro Egypt Factory Workforce app (Next.js 15 + MySQL/MariaDB) from a fresh Linux container with sample data, log in, and drive its pages in headless Chromium to see a change working. Use when asked to run, start, smoke-test or screenshot the app.
---

# Run the app (cold start in a Linux container)

Verified on Ubuntu 24.04 with MariaDB 10.11, Node 20, and the Playwright Chromium that comes pre-installed.
Everything here is local and throw-away: a local database with **fictional** sample data. Never point it at
the production database.

## 1. Database

```bash
# install MariaDB if it isn't there (no systemd in the container: start it by hand)
command -v mariadbd >/dev/null || apt-get install -y -q mariadb-server
mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld
mysqladmin ping 2>/dev/null || { (mysqld_safe >/tmp/mysqld.log 2>&1 &); for i in $(seq 1 20); do mysqladmin ping 2>/dev/null && break; sleep 1; done; }

mysql -e "CREATE DATABASE IF NOT EXISTS afro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
          CREATE USER IF NOT EXISTS 'afro'@'localhost' IDENTIFIED BY 'afro';
          GRANT ALL ON *.* TO 'afro'@'localhost'; FLUSH PRIVILEGES;"
```

The server stops when the container idles. If tests or the app suddenly can't connect
("Can't connect to local server through socket"), run the `mysqladmin ping || mysqld_safe` line again.

## 2. Environment, dependencies, schema, sample data

```bash
cd <repo root>
# .env is gitignored. SESSION_SECRET must be at least 16 characters or the app refuses to start.
[ -f .env ] || printf 'DATABASE_URL="mysql://afro:afro@localhost:3306/afro"\nSESSION_SECRET="local-test-secret-0123456789abcdef"\nPUNCH_API_KEY="x"\n' > .env
npm ci

# NOT `prisma migrate deploy`: on a brand-new MariaDB 10.11 the chain fails at
# 20260906074634_salary_type (P3009). For a local throw-away database, push the schema instead:
npx prisma db push --skip-generate
npm run db:seed:sample        # 50 employees, ~13 days of attendance ending today, 4 logins
```

If a previous `migrate deploy` left the database half-migrated, start over:
`mysql -e "DROP DATABASE afro; CREATE DATABASE afro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`, then `db push` and the seed.

Logins (password `demo123` for all): `admin@404legends.demo` · `hr@afroegypt.demo` · `supervisor@afroegypt.demo` · `ahmed@afroegypt.demo`.

## 3. Build and start

```bash
npm run build
(PORT=3100 nohup npx next start -p 3100 > /tmp/next.log 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}" localhost:3100/login | grep -q 200 && break; sleep 1; done
```

- `next start` prints a warning about `output: "standalone"`. It still serves fine for local checks.
- `[attendance-realtime] reconnect failed: Could not reach the device` in the log is expected: there is no
  fingerprint device here.
- Stop it by PID: `kill $(ss -ltnp | grep 3100 | grep -o 'pid=[0-9]*' | cut -d= -f2)`.
  **Don't** use `pkill -f "next start"`: it also matches (and kills) the shell running the command.

## 4. Drive it

```bash
node .claude/skills/run-app/drive.cjs                 # logs in as admin and visits the main pages
node .claude/skills/run-app/drive.cjs /departments/DEP-1 /payroll   # or only the pages you name
```

It prints each page's HTTP status and `<h1>`, and any console or page errors, and saves screenshots to
`/tmp/run-app-shots/`. **Look at the screenshots**: a 200 with an empty page is still a failure.

Gotchas the driver already handles:
- Never wait for `networkidle`: every page keeps an open SSE stream (`/api/events`), so it never settles.
  Wait for the `h1` plus a short pause instead.
- Client-side navigation (`router.push`, e.g. the period buttons on a report) doesn't fire `load`: use
  `page.waitForURL(url, { waitUntil: "commit" })`.
- Recharts animates its lines in: a screenshot taken right after load shows the axes with no lines. Wait
  about 3 s, or check that `.recharts-line-curve` has a `d` attribute.
- Don't use `screenshot({ fullPage: true })`: it resizes the page for the shot and the charts re-animate from
  empty. The driver grows the viewport to the page height, waits, then takes a normal screenshot.

If the sidebar logo is blank, a Next image-optimizer request got stuck (later requests for the same width wait
on it). Stop the server, `rm -rf .next/cache/images`, start again.

## 5. Tests against the same database

`npm test` uses this same `.env` database. The integration tests skip themselves unless the sample seed is
present (they look for `hr@afroegypt.demo`), so seed first.
