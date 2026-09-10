# S&S Delivery Control — implementation architecture

## Phase 1 — completed prototype
- Control Tower
- Orders
- Issues
- PRE / DURING / POST views
- Local AI Dispatcher demo
- Actual Google Sheet schema mapped

## Phase 2 — live Google Sheet
Backend endpoint: `/api/sheet/today`
- Read current month tab.
- Filter rows for current date.
- Normalize the existing columns into a stable internal `Order` shape.
- Never write to the Sheet in the first live version.

## Phase 3 — live Onfleet
Backend endpoints:
- `/api/onfleet/tasks`
- `/api/onfleet/workers`
- `/api/onfleet/webhook`

The ONFLEET ID from column E is the primary join key.

## Phase 4 — monitoring engine
Server evaluates deterministic rules every time Sheet data refreshes or an Onfleet webhook arrives.

Output:
- OK
- WATCH
- ACTION

## Phase 5 — AI chat
AI gets read-only tools:
- get_today_overview
- get_order
- get_pre_issues
- get_during_issues
- get_post_issues
- compare_sheet_onfleet

Write actions remain disabled until explicit approval workflow is added.
