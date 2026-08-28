# Product Requirements Document (PRD)

**Project Name:** Project Raven  
**Problem Statement ID:** SIH26189  
**Organization:** Ministry of Home Affairs – National Crime Records Bureau (NCRB), Women Safety Division[cite: 1]  
**Category & Theme:** Software | Blockchain & Cybersecurity[cite: 1]  
**Target Milestone:** Smart India Hackathon Prototype & Demonstration  

---

## 1. Executive Summary & Vision

### 1.1 Problem Context
Modern criminal activity is increasingly organized and networked, with suspects connected through associates, financial channels, communication links, shared locations, and events[cite: 1]. Law enforcement agencies collect vast volumes of relevant data (FIRs, CDRs, financial transaction records)[cite: 1]. However, this data remains fragmented, unstructured, and scattered across disconnected systems, meaning investigators must piece together hidden relationships manually[cite: 1].

### 1.2 System Vision (Project Raven)
Raven is an AI-powered Criminal Network Analysis System built as a secure, native Windows desktop application[cite: 1]. It ingests both structured records and unstructured text, and automatically surfaces the hidden relationships within them[cite: 1]. The platform models syndicate structures via graph analytics, tracks suspect movements using spatial constraints, and anchors digital evidence on a semi-private blockchain to ensure AI-generated leads are explainable and auditable, not opaque[cite: 1].

+---------------------------------------------------------------------------------------------------+
|                                 PROJECT RAVEN NATIVE ARCHITECTURE                                 |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  +------------------------+      +---------------------------+      +--------------------------+  |
|  |   Simulated Sources    | ---> | Local Python AI Engine    | ---> |   Dual-Layer Storage     |  |
|  | (CCTNS, CDR, CFCFRMS)  |      | (Ollama + YOLOv8 + OCR)   |      | (Supabase + Blockchain)  |  |
|  +------------------------+      +---------------------------+      +--------------------------+  |
|                                                |                                                  |
|                                                | (Inter-Process Communication / Local RPC)        |
|                                                v                                                  |
|  +---------------------------------------------------------------------------------------------+  |
|  |                              TAURI NATIVE DESKTOP APPLICATION                               |  |
|  |                                                                                             |  |
|  |  [ Rust Core Backend ]                                                                      |  |
|  |  - Manages OS-level memory, local file systems, and secure IPC with Python AI scripts.      |  |
|  |                                                                                             |  |
|  |  [ React / HTML / Tailwind UI via WebView2 ]                                                |  |
|  |  - Neo4j Graph Rendering (Micro & Macro views).                                             |  |
|  |  - Mapbox Geospatial Routing.                                                               |  |
|  |  - Real-time CCTV interaction and anomaly alerts.                                           |  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+

---

## 2. Target Users & Personas

*   **Investigating Officer (IO):** Field-level officers analyzing specific suspect networks, tracking local associates, and reviewing movement routines.
*   **Intelligence Analyst:** Headquarters analysts evaluating macro syndicate hierarchies, detecting anomalies, and identifying key influencers[cite: 1].
*   **Forensic Auditor:** Compliance officers verifying digital evidence integrity via blockchain audit logs.

---

## 3. System Architecture & Tech Stack

| Layer | Component / Technology | Specification & Role |
| :--- | :--- | :--- |
| **Desktop Application** | Tauri (Rust + WebView2) | Ultra-lightweight native executable (.exe) managing memory and OS security. |
| **Frontend UI** | React, Tailwind CSS | Single-pane-of-glass dashboard rendered inside Tauri's webview. |
| **Graph Visualization** | Cytoscape.js | Interactive rendering of P2P network graphs (Micro & Macro). |
| **Geospatial UI** | Leaflet.js / Mapbox GL JS | Geospatial plotting of routine loops and historical cell tower pings. |
| **Relational Database** | Supabase (PostgreSQL) | Structured record storage, Row Level Security (RLS), and file buckets. |
| **Graph Database** | Neo4j | High-performance entity-relationship queries and graph algorithms. |
| **Local NLP Engine** | Python + Ollama (Phi-3 / Gemma 2) | Localized entity extraction running within an 8GB VRAM GPU limit. |
| **Document OCR** | Python + EasyOCR | Optical character recognition for scanned FIR documents. |
| **Computer Vision** | Python + YOLOv8 + OSNet | Pedestrian detection and person re-identification (Re-ID) tracking. |
| **Integrity Ledger** | Hyperledger Fabric | On-chain cryptographic SHA-256 hash storage and audit logging. |

---

## 4. Simulated Government Data Sources

To demonstrate real-world applicability, Raven simulates data feeds from six government nodes:

| Database Node | Real-World System | Simulated Input Format | Pipeline Ingestion Route |
| :--- | :--- | :--- | :--- |
| **CCTNS** | Crime & Criminal Tracking Network | Unstructured PDF Text | EasyOCR -> Local LLM NER -> Supabase/Neo4j |
| **CFCFRMS** | Cyber Fraud Reporting System | Structured CSVs | Direct ETL -> Neo4j Financial Edges |
| **ICJS** | Interoperable Criminal Justice System | Structured JSON | Direct ETL -> Neo4j Relationship Links |
| **VAHAN/SARATHI** | Vehicle & License Registry | Structured SQL / CSV | Database lookup -> Entity Linkage |
| **NAFIS** | Automated Fingerprint Identification| Biometric Hashes | Ground-truth entity deduplication |
| **Telecom Nodal** | Call Detail Records (CDR) | Heavy CSVs (GPS/Logs)| Supabase Location_History -> Routine Maps |

---

## 5. Functional Requirements & Feature Specifications

### 5.1 Module 1: Data Ingestion & Unstructured Parsing Pipeline

*   **FR-1.1 File Ingestion Router:** 
    *   The Rust backend intercepts uploaded files and identifies MIME types.
    *   Structured data bypasses AI parsing and maps to databases. Unstructured/Scanned data is passed securely via IPC to the local Python AI environment.
*   **FR-1.2 Local Named Entity Recognition (NER):** 
    *   The system uses Natural Language Processing and Named Entity Recognition to extract key entities (people, locations, vehicles, phone numbers, and organizations) from unstructured sources[cite: 1].
    *   The LLM operates under a strict 8GB VRAM constraint, enforcing standardized JSON schema outputs.
*   **FR-1.3 Entity Resolution & Deduplication:** 
    *   The pipeline resolves multiple alias mentions to single entities using NAFIS ID matches or shared unique identifiers.

### 5.2 Module 2: Hybrid Storage & Semi-Private Blockchain Audit Ledger

*   **FR-2.1 Off-Chain Heavy Storage (Supabase):** Raw files and structured tables are hosted in Supabase with RLS.
*   **FR-2.2 On-Chain Evidence Integrity:**
    *   Upon ingestion, the Rust core computes a SHA-256 hash of the original document and commits it to the blockchain.
    *   Every automatically detected relationship, entity, or anomaly is presented with supporting evidence[cite: 1]. If an underlying file's hash no longer matches the blockchain ledger, the UI displays a "Tampered Evidence" warning.
*   **FR-2.3 Access Audit Logging:** Investigators can confirm, reject, or annotate system-generated insights, keeping a trained human analyst in the decision loop[cite: 1]. Every interaction writes an immutable access log on-chain.

### 5.3 Module 3: Dual Criminal Net (Micro & Macro Graph Engine)

To prevent visual clutter, the graph UI is strictly restricted to Person-to-Person (P2P) nodes.

*   **FR-3.1 Local Network (Micro View):**
    *   Executes a 1-to-2 hop Neo4j Ego-Graph query centering on a selected suspect.
    *   Clicking a connecting edge opens a side-panel detailing the underlying evidence (e.g., "Co-accused in FIR-102").
*   **FR-3.2 Global Network (Macro View):**
    *   Visualizes the complete criminal ecosystem currently in the database to uncover multi-gang connections.
*   **FR-3.3 Connection Strength (Scoring Matrix):**
    *   Edge thickness/color is determined by a dynamically computed weight matrix:
        *   Weight = Sum(Telecom Call [+1], Money Transfer [+10], Co-Accused [+25], CCTV Co-Location [+10]) * Time_Decay_Factor.

### 5.4 Module 4: Proactive AI Pattern Detection & Influencer Analysis

Rather than requiring an investigator to search for patterns manually, the system surfaces them proactively, ranked by relevance[cite: 1].
*   **FR-4.1 Key Influencer Identification:** The system applies graph analytics and machine learning to identify key influencers—individuals whose position makes them disproportionately important to the network's function[cite: 1].
*   **FR-4.2 Anomaly Trigger Engine:** Background jobs scan databases to flag suspicious patterns such as unusual communication spikes, sudden geographic convergence of known associates, or irregular financial activity[cite: 1].

### 5.5 Module 5: Spatio-Temporal CCTV Tracking & Human-in-the-Loop Re-ID

*   **FR-5.1 Pedestrian Detection & ID Labeling:** 
    *   The Python CV pipeline runs YOLOv8, assigning sequential 2-digit IDs (01, 02) to detected individuals.
    *   The React UI displays these IDs as clickable thumbnails in a side panel next to the video player.
*   **FR-5.2 Human-in-the-Loop Lock-On:**
    *   The investigator selects a target ID from the UI. The backend generates an OSNet Re-ID feature vector ("fingerprint") for that specific target.
*   **FR-5.3 Spatio-Temporal Camera Topology (Compute Optimization):**
    *   To prevent VRAM crashes, cameras are mapped as a physical graph. The AI only activates Re-ID tracking on adjacent downstream cameras during the target's calculated travel-time window.

### 5.6 Module 6: Historical Routine System & Geospatial Mapping

*   **FR-6.1 Data Source Aggregation:** Aggregates location points from extracted CDR coordinates, FIR locations, and registered addresses.
*   **FR-6.2 Geospatial Loop Rendering:**
    *   The UI renders the suspect's chronological movements across a Mapbox map.
    *   Identifies frequent hotspots and visualizes a baseline "daily routine loop," enabling predictive deployment.

---

## 6. Non-Functional Requirements (NFRs)

*   **Memory Efficiency:** Tauri's WebView2 architecture ensures the UI consumes minimal system memory (< 150MB RAM), reserving the system's 8GB GPU VRAM exclusively for Ollama NLP and YOLOv8 CV inference.
*   **Execution Security:** Compiling as a native Rust binary ensures secure, locked-down access to local file systems, mitigating browser-based vulnerabilities.
*   **Graph Query Response:** < 250 ms for 2-hop Ego-Graph rendering on 10,000 nodes.
*   **Data Privacy:** Zero cloud API dependencies for sensitive intelligence text processing.
*   **Evidence Integrity:** 100% SHA-256 match rate across on-chain ledger verifications.