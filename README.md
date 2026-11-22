# AuditWise — Financial Audit Simulator

<p align="center">
  <strong>An interactive financial audit environment for investigating transactions, identifying accounting inconsistencies, and evaluating evidence-based findings.</strong>
</p>

<p align="center">
  <a href="https://auditwise-lovat.vercel.app/">Live Demo</a> ·
  <a href="https://github.com/aktansymbat4-eng/auditwise">GitHub Repository</a>
</p>

---

## Overview

**AuditWise** is a Financial Audit Simulator developed for **GENESIS HACKATHON 2026 — FinTech Challenge**.

The project is designed to provide an interactive environment for exploring financial records, investigating transactions, examining supporting documents, and identifying potential accounting errors.

AuditWise brings together general ledger entries, invoices, payments, and foreign exchange information in a unified audit workspace. It is designed to demonstrate how an auditor or an AI agent can investigate financial data, collect relevant evidence, and submit structured findings for evaluation.

The project uses synthetic financial data to create realistic audit scenarios without exposing real customer financial information.

## Problem Statement

Financial auditing involves reviewing large volumes of interconnected records. Accountants and auditors must compare ledger entries with invoices, payment records, exchange rates, and supporting documents to determine whether transactions are accurate.

This process can become time-consuming and complex, particularly when financial information is distributed across multiple records.

AuditWise addresses this challenge by providing a structured simulation environment where financial relationships can be explored and potential inconsistencies can be investigated systematically.

## Key Features

### 1. Audit Dashboard

The main dashboard provides an overview of the current audit environment.

It displays:
- Total number of ledger records.
- Potential audit findings.
- Current reward information.
- Number of inspection steps completed.
- Remaining investigation step budget.

### 2. General Ledger

The General Ledger section provides a structured table of financial transactions.

Users can explore accounting entries and review information such as:
- Journal entry identifiers.
- Transaction dates.
- Account names and descriptions.
- Debit and credit amounts.
- Currency information.
- Record status.

The interface also provides record search and filtering controls to support financial investigation.

### 3. Evidence Investigation

AuditWise provides a selected-evidence workspace for examining individual financial records and their related documents.

Users can inspect connections between:
- Ledger entries.
- Invoices.
- Payment records.

This helps trace financial transactions and understand how individual records relate to one another.

### 4. Agent Findings

The Agent Findings section is designed to display potential accounting issues identified during an audit investigation.

It organizes findings into four main categories:
- Duplicate Invoices.
- Incorrect Payment Allocation.
- Incorrect FX Conversion.
- Accounting Period Errors.

Findings are intended to be supported by relevant financial evidence before submission and evaluation.

### 5. Reward Performance

The Reward Performance section provides an interface for reviewing audit evaluation results.

It includes:
- Episode reward information.
- Submitted episode history.
- Training and evaluation controls.
- Benchmark policy evaluation.

The purpose of this section is to make audit performance measurable and easier to analyze.

### 6. Benchmark Policies

Benchmark policies provide a way to compare different approaches to financial investigation.

The evaluation interface is designed to support comparisons between agent strategies and help assess their performance across audit scenarios.

### 7. Activity and Trajectory Log

The Recent Activity section displays information about the current audit episode.

The trajectory log is intended to help review the sequence of investigation actions and understand how an agent reaches its findings.

### 8. Multilingual Interface

AuditWise is designed to support three languages:

- English
- Russian
- Kazakh

This makes the interface more accessible to users from different language backgrounds.

## Supported Audit Scenarios

The simulator is organized around four categories of financial errors.

| Error Category | Description |
|---|---|
| Duplicate Invoices | Identifying invoices that have been recorded more than once. |
| Incorrect Payment Allocation | Detecting missing, partial, or incorrectly allocated payments. |
| Incorrect FX Conversion | Identifying inconsistencies in foreign exchange rates or conversion dates. |
| Accounting Period Errors | Detecting transactions recorded in an incorrect accounting period. |

The audit environment also includes legitimate financial patterns and distractors. This is important because not every repeated amount or unusual-looking transaction represents an actual accounting error.

## Technology Stack

The project uses the following technologies:

| Technology | Purpose |
|---|---|
| Next.js 16 | Web application framework |
| React 19 | User interface development |
| TypeScript | Type-safe application development |
| Tailwind CSS 4 | Styling and responsive layouts |
| Base UI | Interface primitives |
| shadcn | UI component tooling |
| Lucide React | Icons |
| pnpm | Package management |
| Vercel | Web application deployment |

## Project Structure

The repository is organized into the following main directories:

```text
auditwise/
│
├── app/                  # Application routes and pages
│
├── components/           # Reusable UI components
│
├── lib/                  # Shared utilities and application logic
│
├── public/               # Static assets
│
├── package.json          # Dependencies and project scripts
├── pnpm-lock.yaml        # Dependency lockfile
├── pnpm-workspace.yaml   # pnpm workspace configuration
├── next.config.mjs       # Next.js configuration
├── tsconfig.json         # TypeScript configuration
└── components.json       # UI component configuration
```

## Getting Started

Follow these instructions to run the project locally.

### Prerequisites

Make sure you have installed:

- Node.js
- pnpm (version 12.3.4)

### 1. Clone the Repository

```bash
git clone https://github.com/aktansymbat4-eng/auditwise.git
```

### 2. Navigate to the Project Directory

```bash
cd auditwise
```

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Start the Development Server

```bash
pnpm dev
```

Open your browser and navigate to:

```text
http://localhost:3000
```

### 5. Create a Production Build

```bash
pnpm build
```

### 6. Run the Production Server

```bash
pnpm start
```

## Verification

The project includes an offline verification command:

```bash
pnpm verify:offline
```

This command runs the verification script configured in the project.

For additional information about the verification process and its results, refer to the script implementation and its output.

## Live Demo

The deployed application is available here:

**https://auditwise-lovat.vercel.app/**

The source code is available here:

**https://github.com/aktansymbat4-eng/auditwise**

## Project Goals

AuditWise aims to explore how structured financial data and evidence-based investigation can support automated auditing.

The project focuses on:

- Making financial records easier to explore.
- Connecting accounting entries with supporting documents.
- Identifying potential accounting inconsistencies.
- Encouraging evidence-based audit findings.
- Supporting measurable evaluation of audit performance.
- Providing a reproducible environment for experimenting with financial audit approaches.

## Project Status

**Project:** AuditWise — Financial Audit Simulator  
**Event:** GENESIS HACKATHON 2026 — FinTech Challenge  
**Version:** 0.9.0

The current repository contains the Next.js web application and its interface components. The live demonstration presents the audit workspace and its evaluation-oriented sections.

The implementation status of the underlying simulation engine, agent execution, and evaluation logic should be verified separately through the corresponding source code and offline checks.

## Data Privacy

AuditWise is designed around synthetic financial data. It does not require real customer financial records for its demonstration scenarios.

---

<p align="center">
  <strong>AuditWise — Bringing Structure and Transparency to Financial Audit Investigation.</strong>
</p>
