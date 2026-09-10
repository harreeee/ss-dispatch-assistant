# Live data mapping — 2026 UPCOMING DELIVERIES

Source tab for current month: `September 2026`

## Existing Sheet columns used by the app

| Column | Sheet header | App use |
|---|---|---|
| A | Notes | Order notes / people / value / flags |
| B | Providor | Vendor / account |
| C | workerName | Restaurant / worker reference |
| D | Booked?/ Driver | Booking / driver / manual notes |
| E | ONFLEET ID | Primary link to Onfleet task |
| F | Order Date | Delivery date |
| G | Pickup Time | Planned pickup |
| H | Pickup Address | Planned pickup address |
| I | Client Delivery Time | Required delivery window |
| J | Client Delivery Address | Delivery address |
| K | Restaurant | Restaurant/client label where present |
| L | Delivery Instructions | Operational instructions |
| M | Contact Information | Contact/company notes |
| N | Contact Phone # | Contact details |
| O | Papi Bags | Bag-related data where used |
| Q | #ofdrivers | Multi-driver requirement |
| R | BAGS/people | Bag / people requirement |
| S | VAN | Vehicle requirement |
| T | Waiting Time | Post-order metric |
| U | Loading Time | Post-order metric |
| V | Unloading time | Post-order metric |
| W | KM | Distance / post-order metric |
| Y | Tips | Post-order metric |
| Z | Charges | Post-order metric |

## Matching logic

1. If column E contains a valid Onfleet task identifier, use it as the primary join key.
2. If column E is blank or contains a manual note, the row is treated as `NOT LINKED` until a real Onfleet task is found/created.
3. Fallback matching (later phase only): date + pickup address + delivery address + pickup time.

## PRE checks

- Order scheduled today but ONFLEET ID blank -> ACTION
- Pickup < 30 min and no valid Onfleet task -> ACTION
- Driver/booking notes indicate manual handling -> WATCH
- Van/bag/multi-driver requirement exists -> surface as operational requirement
- Delivery time/address mismatch between Sheet and Onfleet -> ACTION/WATCH by severity

## DURING checks

- Onfleet predicted delay >= 10 min -> ACTION
- Onfleet predicted delay 5–9 min -> WATCH
- Pickup time passed and task not started -> ACTION
- ETA leaves <= 5 min delivery buffer -> WATCH
- Task failed -> ACTION

## POST checks

- Onfleet completed late -> WATCH/ACTION based on threshold
- Onfleet completed but post-order fields still missing -> WATCH
- Failed/cancelled status conflicts with Sheet -> ACTION
- Capture waiting/loading/unloading/KM/tips/charges when present
