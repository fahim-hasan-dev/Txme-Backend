# Txme Backend — Service Marketplace & Exchange Platform API

![Node.js](https://img.shields.io/badge/Node.js-v18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-5.1-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose%208.13-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4.8-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-API%2018.1-008CDD?style=for-the-badge&logo=stripe&logoColor=white)

---

## 📌 Table of Contents

- [Overview](#-overview)
- [System Architecture](#-system-architecture)
- [Key Features](#-key-features)
- [Tech Stack & Third-Party Services](#-tech-stack--third-party-services)
- [Project Directory Structure](#-project-directory-structure)
- [Data Models & Schema Architecture](#-data-models--schema-architecture)
- [API Modules & Route Reference](#-api-modules--route-reference)
- [Real-Time Socket Communications](#-real-time-socket-communications)
- [Automated Background Cron Jobs](#-automated-background-cron-jobs)
- [Environment Variables Configuration](#-environment-variables-configuration)
- [Getting Started & Installation](#-getting-started--installation)
- [Scripts & Developer Utilities](#-scripts--developer-utilities)

---

## 📖 Overview

**Txme Backend** (also known as Save & Date / Txme Exchange) is an enterprise-grade RESTful API and real-time backend platform built using **Node.js, Express (v5), TypeScript, and MongoDB (Mongoose)**. 

The platform connects **Customers** seeking specialized services with **Service Providers** offering hourly or date-based appointments. It incorporates multi-channel verification (Email, SMS, Biometrics), Automated Identity Verification (Didit &  KYC), a Digital Wallet engine with Stripe payment gateway integration, real-time Socket.io chat, dynamic service promotions, and PDF invoice generation.

---

## 🏗️ System Architecture

```
                                  +-----------------------+
                                  |   Mobile & Web Apps   |
                                  +-----------+-----------+
                                              |
                                HTTP / HTTPS  |  WebSockets (Socket.io)
                                              v
                              +---------------+---------------+
                              |    Express 5 / Node.js API    |
                              |      (TypeScript Server)      |
                              +---------------+---------------+
                                              |
        +-------------------------+-----------+-----------+-------------------------+
        |                         |                       |                         |
        v                         v                       v                         v
+---------------+       +------------------+    +---------------+       +---------------+
|   MongoDB     |       | Stripe & Wallet  |    | Didit / KYC   |       | AWS / Cloud   |
| (Mongoose ORM)|       | Payment Gateway  |    | Verification  |       | (S3/SES/SNS)  |
+---------------+       +------------------+    +---------------+       +---------------+
```

### Architectural Highlights
- **Modular Monolith**: Clean separation into `controllers`, `services`, `routes`, `validations`, `interfaces`, and `models` for 20+ functional domain modules.
- **Role-Based Access Control (RBAC)**: Strict authorization guards distinguishing `CUSTOMER`, `PROVIDER`, `ADMIN`, and `SUPER_ADMIN`.
- **Event-Driven Communications**: Real-time communication via Socket.io for messaging and active connection status.
- **Robust Error Handling**: Centralized global error handling middleware (`globalErrorHandler`) with custom `ApiError` instances and Zod schema validations.
- **Logging & Auditing**: Integrated Winston daily log rotators, Morgan HTTP request logs, and database-level `AuditLog` records for security compliance.

---

## 🔥 Key Features

### 1. 🔐 Authentication & Identity Management
- **Multi-Factor OTP Verification**: Email and SMS OTP verification via AWS SES, Nodemailer, and AWS SNS.
- **Biometric Authentication**: Secure JWT-based biometric enrollment and quick login.
- **Account Recovery & Phone Updates**: Dedicated OTP workflows for password reset and phone number changes.
- **Automated Cleanup**: Daily background cron job purging unverified inactive user accounts.

### 2. 🆔 Identity Verification (KYC)
- **Didit KYC Integration**: Session creation and automated webhook handlers for seamless ID document verification.
- ** Compliance**: Automated identity validation against fraud and compliance databases.

### 3. 💼 Service Provider Ecosystem
- **Rich Profiles**: Dynamic attributes including hourly rates, skills, working hours, working days, certifications, and languages spoken.
- **Geo-Location Search**: Location-aware service matching using coordinates (Latitude/Longitude) and search radius.
- **Promotions & Sponsored Listings**: Provider promotion packages with automated expiry management via cron.

### 4. 📅 Appointment & Booking Engine
- **Slot Availability Validation**: Automated checking of provider availability, working hours, and conflicting dates.
- **Status Lifecycle**: Full lifecycle tracking (`pending` ➔ `confirmed` ➔ `completed` / `cancelled`).
- **Invoice Generation**: Auto-generation of transaction invoices in PDF format upon completion.

### 5. 💳 Financial Infrastructure & Digital Wallet
- **In-App Wallet**: Internal ledger tracking balances, deposits, and peer-to-peer money transfers between users.
- **Stripe Top-Up**: Top-up wallet balances using Stripe Payment Intents and webhook listeners.
- **Provider Withdrawals**: Payout handling via Stripe Connect accounts (`stripeAccountId`).
- **Wallet Diagnostics**: Included CLI diagnostic tool (`diagnose_wallet.ts`) for ledger audit and balance checks.

### 6. 💬 Real-Time Chat & Media Sharing
- **Socket.io Integration**: Multi-room chat infrastructure supporting direct messages and conversation threads.
- **Media Attachments**: File storage support via local disk storage and local disk storage processors.

### 7. 🔔 Push & In-App Notifications
- **Firebase Cloud Messaging (FCM)**: Push notification dispatch for mobile devices.
- **Real-Time WebSockets**: In-app socket events for real-time alert updates.

---

## 🛠️ Tech Stack & Third-Party Services

| Category | Technology / Library | Description |
|---|---|---|
| **Runtime & Language** | Node.js (v18+), TypeScript (v5.8) | Type-safe JavaScript execution |
| **Web Framework** | Express.js (v5.1) | Fast, unopinionated HTTP server framework |
| **Database & ODM** | MongoDB, Mongoose (v8.13) | Document database with schema modeling |
| **Validation** | Zod (v3.24) | Type-safe schema validation for requests |
| **Authentication** | JSON Web Tokens (jsonwebtoken), BcryptJS, RSA | Token-based security and password hashing |
| **Payments** | Stripe API (v18.1) | Payment Intents, Connect accounts, and Webhooks |
| **Real-Time Communication** | Socket.io (v4.8) | WebSocket server for chat & live events |
| **Cloud Storage** | AWS S3 (`@aws-sdk/client-s3`), local disk storage | Media and document asset management |
| **KYC / Verification** | Didit Protocol (`@didit/api`),  | Identity and compliance verification |
| **Email & SMS** | AWS SES, Nodemailer, AWS SNS | Transactional messages and OTP dispatches |
| **Push Notifications** | Firebase Admin SDK (v13.6) | Mobile device FCM push notifications |
| **PDF Generation** | PDFKit (v0.17) | Automated invoice PDF generation |
| **Logging & Security** | Winston, Morgan, Express-Rate-Limit, Request-IP | Audit logging, rate limiting, and client IP tracking |

---

## 📁 Project Directory Structure

```
Txme-Backend/
├── example.env                       # Environment variables template
├── diagnose_wallet.ts                # Diagnostic script for checking wallet balances
├── test-geocoding.ts                 # Test utility for location geocoding
├── tsconfig.json                     # TypeScript configuration
├── package.json                      # Dependencies and scripts
└── src/
    ├── server.ts                     # Main entrypoint (Database connect, Cron, Socket setup)
    ├── app.ts                        # Express application setup, middlewares, routes
    ├── DB/                           # Super Admin database seed scripts
    ├── config/                       # Centralized application environment configurations
    ├── cronjob/                      # Background scheduled jobs
    │   ├── checkPromotionExpiry.ts             # Expired provider promotions handler
    │   └── scheduleUnverifiedAccountCleanup.ts # Inactive unverified account cleanup
    ├── enums/                        # Application enums (Roles, Languages, Statuses)
    ├── errors/                       # Custom ApiError class and error formats
    ├── helpers/                      # Shared helper functions (Socket, JWT, AWS, Stripe)
    ├── shared/                       # Logger (Winston, Morgan) and shared utilities
    ├── stripe/                       # Stripe Webhook handlers
    ├── types/                        # Global TypeScript interfaces & index augmentations
    ├── util/                         # Utility functions
    └── app/
        ├── middlewares/              # Express middlewares (auth, globalErrorHandler, rateLimiter)
        ├── routes/                   # Central API Router registry (`/api/v1/`)
        └── modules/                  # Modular Feature Domains
            ├── admin/                # Platform administration endpoints
            ├── appointment/          # Booking and scheduling engine
            ├── auditLog/             # System audit logging
            ├── auth/                 # OTP, Login, Refresh, Biometrics, Password reset
            ├── chat/                 # Chat rooms & conversation management
            ├── invoice/              # Invoice management & PDF downloads
            ├── kyc/                  # Didit &  KYC handlers
            ├── message/              # Chat messaging & media attachments
            ├── notification/         # Notification management & FCM tokens
            ├── promotion/            # Featured provider promotion packages
            ├── provider/             # Service Provider profile & search
            ├── review/               # Rating & customer feedback
            ├── rule/                 # Privacy Policy, Terms, App Rules
            ├── service/              # Service categories & offerings
            ├── setting/              # Dynamic application settings & FAQ
            ├── stripe/               # Stripe payment intents & Connect onboarding
            ├── support/              # Customer support ticketing
            ├── transaction/          # Financial ledger transactions
            ├── user/                 # User management schema & controllers
            └── wallet/               # User wallet, send money & withdrawal management
```

---

## 📊 Data Models & Schema Architecture

The database architecture consists of key linked Mongoose schemas:

```mermaid
erDiagram
    USER ||--o{ APPOINTMENT : "books (as Customer)"
    USER ||--o{ APPOINTMENT : "provides (as Provider)"
    USER ||--o1 WALLET : "owns"
    USER ||--o{ REVIEW : "gives / receives"
    USER ||--o{ NOTIFICATION : "receives"
    USER ||--o{ SUPPORT : "creates"
    APPOINTMENT ||--o1 INVOICE : "generates"
    WALLET ||--o{ TRANSACTION : "records"
    CHAT ||--o{ MESSAGE : "contains"
    USER ||--o{ CHAT : "participates"
```

1. **User Schema (`User`)**: Stores common credentials, roles (`CUSTOMER`, `PROVIDER`, `ADMIN`, `SUPER_ADMIN`), address coordinates, KYC verification status, biometric configuration, and `providerProfile` metadata (rates, hours, skills, days).
2. **Wallet Schema (`Wallet`)**: Associated 1:1 with each User, storing currency balances, held funds, and account status.
3. **Transaction Schema (`Transaction`)**: Records financial operations (`TOP_UP`, `WITHDRAWAL`, `TRANSFER`, `PAYMENT`) with status tracking (`PENDING`, `COMPLETED`, `FAILED`).
4. **Appointment Schema (`Appointment`)**: Tracks customer-provider bookings, service IDs, scheduled date/time, total price, payment status, and booking status.
5. **Chat & Message Schemas**: Stores conversations between buyers and providers along with socket message histories.

---

## 🔌 API Modules & Route Reference

Base API Route: `/api/v1`

| Prefix Route | Module | Purpose & Core Functionality |
|---|---|---|
| `/api/v1/auth` | Authentication | OTP send/verify, Login, Refresh token, Biometrics, Profile completion |
| `/api/v1/user` | User Management | Get profile, update user details, block/unblock users, profile picture upload |
| `/api/v1/provider` | Service Providers | Provider search, availability filters, geographic location lookup |
| `/api/v1/service` | Service Offerings | Create, view, update, and delete service categories & options |
| `/api/v1/appointment` | Bookings | Create appointments, update appointment status, customer/provider history |
| `/api/v1/wallet` | Digital Wallet | Check balance, top-up funds, transfer money between wallets, request withdrawals |
| `/api/v1/stripe` | Stripe Gateway | Create PaymentIntents, Connect account onboarding links, webhook listener |
| `/api/v1/kyc` | KYC Verification | Didit identity verification session creation & webhook event processing |
| `/api/v1/invoice` | Invoices | View booking invoices & stream PDF receipts via PDFKit |
| `/api/v1/chat` | Chat Rooms | Manage chat conversations between customers and providers |
| `/api/v1/message` | Direct Messaging | Send message content, fetch room messages, upload chat attachments |
| `/api/v1/promotion` | Promotions | Buy provider featured promotions, check promotion validity |
| `/api/v1/review` | Ratings & Reviews | Post provider reviews, view provider average ratings |
| `/api/v1/notification` | Notifications | Retrieve user notifications, mark as read, update FCM device tokens |
| `/api/v1/admin` | Platform Admin | Admin overview metrics, user control, system management |
| `/api/v1/audit-log` | System Audit | Track administrative actions and security log entries |
| `/api/v1/support` | Customer Support | Create support tickets, issue responses, resolve tickets |
| `/api/v1/setting` | App Settings | Frequently Asked Questions (FAQs), dynamic config parameters |
| `/api/v1/rule` | Legal & Rules | Platform Terms & Conditions, Privacy Policy endpoints |

---

## ⚡ Real-Time Socket Communications

The server initializes a **Socket.io** connection alongside the Express HTTP listener. 

- **Connection Setup**: Configured with CORS enabled and a ping timeout of 60 seconds.
- **Global Access**: Bound globally to `global.io` for dispatching events directly from controllers or services.
- **Events Supported**:
  - Direct real-time messaging between users.
  - Active user status updates (connect / disconnect logging).
  - Live notification alerts.

---

## ⏰ Automated Background Cron Jobs

Powered by `node-cron`, two automated background processes execute periodically:

1. **Unverified Account Cleanup (`scheduleUnverifiedAccountCleanup`)**:
   - Sweeps the database for unverified pending user registrations older than the cutoff threshold and removes them to prevent database bloating.
2. **Promotion Expiry Check (`checkPromotionExpiry`)**:
   - Monitors active provider promotions (`isPromoted`), resets expired provider promotion badges, and clears expired dates.

---

## 🔑 Environment Variables Configuration

Copy `example.env` to `.env` and configure the following parameters:

```env
# Application Core Config
NODE_ENV=development
IP=127.0.0.1
PORT=6005
DATABASE_URL=mongodb://localhost:27017/save-and-date

# Security & Hashing
BCRYPT_SALT_ROUNDS=12

# JWT Authentication
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRE_IN=1d
JWT_REFRESH_SECRET=your_refresh_secret_key
JWT_REFRESH_EXPIRES_IN=7d
JWT_BIOMETRIC_SECRET=your_biometric_secret
JWT_BIOMETRIC_EXPIRES_IN=30d

# SMTP Email Setup
EMAIL_FROM=noreply@txme.com
EMAIL_USER=your_email_user
EMAIL_PASS=your_email_password
EMAIL_PORT=587
EMAIL_HOST=smtp.gmail.com

# Stripe Integration
STRIPE_API_SECRET=sk_test_...
WEBHOOK_SECRET=whsec_...
SUCCESS_URL=https://txme-exchange.com/payment-success


# KYC Verification (Didit & )
DIDIT_API_KEY=your_didit_api_key
DIDIT_WEBHOOK_SECRET=your_didit_webhook_secret
DIDIT_WORKFLOW_ID=your_workflow_id

# Google Maps API (Geocoding & Location)
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

---

## 🚀 Getting Started & Installation

### Prerequisites
- **Node.js**: v18.x or higher
- **MongoDB**: Local MongoDB instance or MongoDB Atlas cluster URI
- **Package Manager**: npm or yarn

### Step-by-Step Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/fahim-hasan-dev/Txme-Backend.git
   cd Txme-Backend
   ```

2. **Install Dependencies**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Setup Environment File**
   ```bash
   cp example.env .env
   # Edit .env with your local credentials and API keys
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```
   *The server will start listening on the configured port (e.g., `http://127.0.0.1:6005`). Database connection will establish, and the Super Admin account will be auto-seeded if not present.*

5. **Build for Production**
   ```bash
   npm run build
   ```

6. **Start Production Server**
   ```bash
   npm start
   ```

---

## 🛠️ Scripts & Developer Utilities

| Command | Action |
|---|---|
| `npm run dev` | Runs the server in hot-reloading development mode via `ts-node-dev` |
| `npm run build` | Compiles TypeScript code in `src/` to JavaScript output in `dist/` |
| `npm start` | Launches the compiled production server from `dist/server.js` |
| `npm run create-module` | Generator utility script (`src/gm.ts`) to quickly scaffold a new module (Route, Controller, Service, Interface, Model) |
| `npx ts-node diagnose_wallet.ts` | Runs the wallet ledger diagnostic tool |

---

## 📄 License

This project is licensed under the **ISC License**. Developed by [Fahim](https://github.com/fahim-hasan-dev).
