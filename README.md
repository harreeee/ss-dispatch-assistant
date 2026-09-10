# S&S Delivery Control — V1 Prototype

A zero-dependency front-end prototype for monitoring delivery operations across Google Sheets and Onfleet.

## Current V1
- Control Tower overview
- PRE / DURING / POST lifecycle monitoring
- Rule-based issue prioritization (OK / WATCH / ACTION)
- Combined Orders view
- Issues view with filters
- AI Dispatcher demo chat using local sample data
- Responsive desktop/mobile layout
- Integration setup placeholder for Google Sheets and Onfleet

## Open locally
Open `index.html` in any modern browser.

## Next integration phase
1. Google Sheets API: read the Delivery Sheet and normalize planned orders.
2. Onfleet API: read tasks/workers and map them using Order ID.
3. Onfleet webhooks: receive assignment, ETA, delay, completion and failure events.
4. Replace the demo `orders` array with merged live data.
5. Add authenticated users and persistent issue history.
6. Add OpenAI-powered natural-language chat after the live data layer is stable.

## Proposed core matching rule
`Delivery Sheet Order ID` must match `Onfleet task shortId/metadata order ID`.
