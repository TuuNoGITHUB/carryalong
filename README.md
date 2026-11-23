# CarryAlong

[Open CarryAlong](https://tuunogithub.github.io/carryalong/)

CarryAlong is a mobile web demo for matching small favors with trips that commuters already plan to make between HKUST and the MTR. It was built as a COMP1945 group project.

Try **Campus envelope** to see the KNN recommendation and point quote. Reserve a trip with demo points, accept as the traveler, mark pickup, and confirm delivery from the handoff pass. The traveler earns 2 bonus points for accepting within 30 seconds and 3 for beating the estimated journey time. After pickup, one real second represents one demo minute. The sender pays the base quote.

Try **Takeaway food** to see the additional-bag capacity. A request can include custom pickup and drop-off places and instructions. Add map-pin coordinates to estimate extra walking from the supported stops using straight-line distance. For a place without a pin, the parties agree on the details and any extra time.

Trips, travel times, handoffs, and points are simulated. **Nearby stop** uses a one-time location reading in the browser without storing it. Manually entered handoff details and demo activity are saved in your browser.

## Run locally

Open `index.html` in a browser. The bundled page includes all runtime assets. To rebuild it from the source files, run `node build.mjs`.
