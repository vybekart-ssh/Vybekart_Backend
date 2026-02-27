# 🌊 VybeKart: Application Flow & Architecture

This document outlines the end-to-end data flow for the VybeKart application, demonstrating a production-grade architecture handling Authentication, Live Streaming, Real-time Interaction, and E-commerce.

---

## 🏗️ High-Level Architecture

```mermaid
graph TD
    subgraph Client_Side ["📱 Android Application"]
        SellerApp["🎥 Seller (Broadcaster)"]
        BuyerApp["👀 Buyer (Viewer)"]
    end

    subgraph Backend_Services ["☁️ NestJS Backend"]
        API["REST API (HTTP)"]
        Gateway["Real-time Gateway (Socket.io)"]
        Auth["Auth Service (JWT)"]
        StreamMgr["Stream Manager"]
    end

    subgraph Infrastructure ["🏗️ Infrastructure"]
        DB[(PostgreSQL)]
        Cache[(Redis)]
        IVS["Media Server (AWS IVS / Mux)"]
    end

    SellerApp -->|1. Login/Auth| API
    SellerApp -->|2. Create Stream| API
    API -->|3. Get Stream Key| IVS
    IVS -->|4. Return RTMP URL| API
    API -->|5. Save Meta| DB
    API -->|6. Return Config| SellerApp
    SellerApp -->|7. Push Video (RTMP)| IVS
    
    BuyerApp -->|8. Fetch Streams| API
    BuyerApp -->|9. Join Room| Gateway
    BuyerApp -->|10. Watch Video (HLS)| IVS
    
    SellerApp -.->|11. Chat/Likes| Gateway
    BuyerApp -.->|11. Chat/Likes| Gateway
    Gateway -.->|12. Broadcast| SellerApp & BuyerApp
```

---

## 🎬 1. The Seller Journey (Going Live)

### Step 1: Authentication
*   **Action**: Seller logs in via the Android App.
*   **Backend**: Validates credentials, issues a **JWT Token**.
*   **Result**: App stores JWT for future authenticated requests.

### Step 2: Initiating a Stream
*   **Action**: User taps "Go Live", enters Title ("Selling Vintage Sneakers") & uploads a thumbnail.
*   **Backend (`POST /streams`)**:
    1.  Validates user permissions.
    2.  Calls **Media Provider** (AWS IVS) to allocate a channel.
    3.  Receives unique `streamKey`, `rtmpIngestUrl`, and `hlsPlaybackUrl`.
    4.  Creates a **Stream Record** in PostgreSQL with status `isLive: true`.
    5.  Returns ingestion details to the Android App.
*   **Android App**: Initializes **RTMP Broadcaster** (e.g., HaishinKit) with the provided `rtmpIngestUrl` + `streamKey`.

### Step 3: Broadcasting
*   **Action**: Seller camera feed is pushed to the Media Server.
*   **Latency**: Low-latency (2-5s) transcoding happens in the cloud.
*   **Notification**: Backend sends Push Notification (FCM) to Seller's followers: *"Sahil is live!"*.

---

## 🛍️ 2. The Buyer Journey (Watching & Buying)

### Step 1: Discovery
*   **Action**: Buyer opens the app feed.
*   **Backend (`GET /streams/active`)**: Queries PostgreSQL for all streams where `isLive: true`.
*   **Result**: List of active streams with thumbnails and viewer counts.

### Step 2: Joining a Room
*   **Action**: Buyer taps a stream.
*   **Video**: Android App passes returned `hlsPlaybackUrl` to **ExoPlayer**. Video starts playing.
*   **Real-time**: App connects to **Socket.io** namespace `/streams` and emits `join_room` event with `streamId`.
*   **Backend**: Adds socket connection to the specific Room ID. Updates "Current Viewers" count in Redis (cached for speed) and broadcasts new count to all room members.

### Step 3: Interaction (Chat & Likes)
*   **Chat**: Buyer types "Show size 10".
    *   App emits `send_message` -> Backend validates -> Broadcasts `new_message` to Room.
*   **Likes**: Buyer spams the heart button.
    *   App batches hearts (throttle) -> Emits `send_likes` -> Backend aggregates -> Broadcasts `floating_hearts` animation trigger.

### Step 4: Purchasing
1.  **Pinning**: Seller selects a product from their inventory.
    *   Backend emits `pin_product` event via Socket.
    *   Buyer sees "Nike Air Jordan" pop up on screen.
2.  **Checkout**: Buyer taps "Buy Now".
    *   **Backend (`POST /orders`)**:
        1.  Checks Inventory (PostgreSQL transaction).
        2.  Creates Pending Order.
        3.  Initiates Stripe Payment Intent.
    *   **Success**: Webhook confirms payment -> Inventory deducted -> Seller notified "New Order!".

---

## 💾 3. Data Flow Summary

| Component | Responsibility | Technology |
| :--- | :--- | :--- |
| **Video Ingest** | Accepting raw video from Seller | RTMP (TCP 1935) |
| **Video Delivery** | Distributing video to Buyers | HLS (HTTPS m3u8) |
| **Metadata** | Users, Products, Stream Info | PostgreSQL (ACID compliant) |
| **Hot Data** | Viewer Counts, Session Caching | Redis (In-memory speed) |
| **Signaling** | Chat, Likes, Product Popups | Socket.io (WebSockets) |

