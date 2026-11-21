# AcxiomCRM — MERN Stack CRM

Role-based CRM (MongoDB · Express · React · Node.js) built to the *AcxiomCRM Complete Project Assignment* specification.

## Run it

Requirements: Node.js 18+ and MongoDB 6+ running locally (or a MongoDB Atlas URI).

```bash
npm run install:all                 # installs server + client
cp server/.env.example server/.env  # then set JWT_SECRET, CSRF_SECRET, MONGO_URI
npm run seed                        # demo users + sample CRM data
npm run server                      # API  → http://localhost:5000  (docs: /api/docs)
npm run client                      # UI   → http://localhost:5173
npm test                            # automated acceptance tests (needs MongoDB)
```

Production: `npm run build` then `npm start` — Express serves the built React app on port 5000.

**Demo logins** (password for all: `Acxiom@2026`)

| Username | Role | Scope |
|---|---|---|
| admin | Admin | everything |
| neha.manager / vikram.manager | Manager | own + team (rahul & priya / amit & sneha) |
| rahul.sales, priya.sales, amit.sales, sneha.sales | SalesExecutive | own/assigned records |

## 17.2 Mandatory Module Tree → where it is

| Module | Feature | Implementation |
|---|---|---|
| **Authentication** | Login / Register / Logout | `/login`, `/register`, user menu → Logout (`/api/auth/*`) |
| | Access Control | `Protected` routes in `client/src/main.jsx`; server `authenticate` + `requirePermission` + record scope (`services/scopeService.js`) |
| **Dashboard** | Total Customers, Total Leads, Open/Won/Lost Opportunities, Sales Pipeline value, Charts | `pages/Dashboard.jsx`, `services/dashboardService.js` — Chart.js: Lead Status, Opportunity Pipeline, Monthly Sales; Today/Week/Month/Custom filter |
| **Customer Management** | Create, Edit, Details, Delete, Search | `pages/Customers.jsx` — search by Name/Email/Phone/Company |
| **Lead Management** | Create, Edit, Details, Delete, Lead Status, Lead Conversion | `pages/Leads.jsx` — workflow-validated status buttons, Convert → Customer + Opportunity |
| **Opportunity Management** | Create, Edit, Details, Delete, Sales Pipeline | `pages/Opportunities.jsx` — Kanban pipeline (drag & drop), Won/Lost outcome capture |
| **Follow-Up** | Schedule, Complete, Pending | `pages/FollowUps.jsx` — Pending/Overdue/Due Today/Upcoming tabs, reschedule, missed, cancel |
| **Activity Management** | Call, Meeting, Email, Task | `pages/Activities.jsx` — tabs per type |
| **User & Role Management** | Users, Roles, Permissions | `pages/Admin.jsx` — create/edit/activate/deactivate, reset password, unlock; editable permission matrix |
| **Audit Log** | Login, Create, Update, Delete | `pages/AuditLog.jsx` — filter by user/module/action/result/date, CSV export, append-only |

Also included: 8 Reports (Customer, Lead, Follow-Up, Opportunity, Pipeline, Sales/Conversion, User Activity, Audit) with filters, sorting, pagination and CSV export; global search; notification bell for due/overdue follow-ups.

## UI theme

"Teal & Coral" design: Bootstrap 5 compiled from Sass with a custom palette (`client/src/theme.scss`), Plus Jakarta Sans typography, light floating sidebar with grouped sections and a user card, hero-style dashboard with Chart.js line/doughnut/horizontal-bar charts, split-screen login, soft status badges and a colour-coded Kanban pipeline. Layout-level styles live in `client/src/styles.css`.

## Validation (section 5 / 17.5–17.8)

Client-side (`client/src/utils/validation.js`, inline Bootstrap messages) **and** server-side (Joi at the API boundary + business rules in services):

| Rule | Message |
|---|---|
| Opportunity Amount ≤ 0 (active) | Opportunity Amount must be greater than 0. |
| Probability outside 0–100 | Probability must be between 0 and 100. |
| Expected Close Date in the past (active) | Expected Close Date cannot be in the past. |
| Follow-up before today | Follow-up date cannot be earlier than today. |
| Invalid email / phone (10-digit Indian mobile) | Enter a valid email address. / Enter a valid phone number. |
| Required / length | Field-specific messages |
| Customer duplicates | Unique email, unique phone, same name + company blocked → **409** |
| Lead | Name required, expected value 0–₹100 cr, status from valid set, configured transitions only |

## Security (sections 6, 14, 17.9)

| Requirement | MERN implementation (equivalent of the ASP.NET Identity items in the PDF) |
|---|---|
| Password hashing | bcrypt (adaptive, cost 12); hashes `select:false`, never in DTOs/logs |
| Password policy | min 8, upper/lower/digit/special, not containing username, last 3 passwords blocked |
| Lockout | 5 failed attempts → 15-min lock (configurable), audited; admin unlock |
| Session | JWT in httpOnly, SameSite=Strict, Secure (prod) cookie; revoked on logout; invalidated on password/role change or deactivation |
| Anti-forgery | Signed double-submit token (`XSRF-TOKEN` cookie ↔ `X-XSRF-TOKEN` header) on every POST/PUT/PATCH/DELETE |
| Authorization | Role permissions + data scope enforced server-side on every endpoint; URL tampering → 403 |
| Injection | Mongoose query API only, Joi stripping, `$`-key removal, scalar query params, escaped regex |
| API | DTOs only, consistent error object, 200/201/400/401/403/404/409/423/429, rate-limited auth, Helmet headers, HTTPS redirect in production |
| Secrets | `.env` (git-ignored), never hard-coded |

## Architecture

```
server/src
├── config/        configuration, DB, constants (roles, statuses, permissions)
├── models/        Mongoose entities (User, Role, Customer, Lead, Opportunity, FollowUp, Activity, AuditLog)
├── validators/    Joi request schemas (API boundary)
├── middleware/    auth, permissions, CSRF, rate limit, sanitising, error handler
├── services/      business rules & workflows (data access via models)
├── dtos/          response mappers (no entity leaks)
├── controllers/   thin HTTP layer
├── routes/        REST endpoints
├── docs/          OpenAPI spec → /api/docs
└── seed/          roles + demo data
client/src         React + Bootstrap 5 (Sass theme) + Chart.js (pages, components, context, utils)
```

## Acceptance scenario 17.19

`server/tests/acceptance.test.js` automates it: anonymous access blocked, register/login, client/server validation, opportunity & follow-up rules, lead workflow + conversion, role scope (Sales/Manager/Admin), audit entries, `/api/customers` JSON, dashboard data, lockout and logout — **13/13 passing**.
