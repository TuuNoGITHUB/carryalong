# CarryAlong

[Open CarryAlong](https://tuuno1221.github.io/carryalong/)

CarryAlong is a mobile web demo for matching small favors with trips that commuters already plan to make between HKUST and the MTR. It was built as a COMP1945 group project.

Try **Campus envelope** to see the KNN recommendation and point quote. Reserve a trip with demo points, accept as the traveler, mark pickup, and confirm delivery from the handoff pass. The traveler earns 2 bonus points for accepting within 30 seconds and 3 for beating the estimated journey time. After pickup, one real second represents one demo minute. The sender pays the base quote.

Try **Takeaway food** to see the additional-bag capacity. A request can include custom pickup and drop-off places and instructions. On Home or Send a favor, tap **Set pickup** or **Set drop-off**, then tap the map. You can drag a pin later or enter coordinates manually. Pin detours are estimated using straight-line distance from the supported stops. For a place without a pin, the parties agree on the details and any extra time.

Trips, travel times, handoffs, and points are simulated. **My location** and **Nearby stop** request a one-time location reading. The device location is kept in the current browser session. [OpenStreetMap](https://www.openstreetmap.org/copyright) serves street tiles for the area you view. Saved handoff details and demo activity stay in your browser.

## Run locally

Open `index.html` in a browser. The hosted version loads street tiles. The standalone file supports stop markers and pin placement with a grid fallback. Run `node build.mjs` to rebuild it from the included source files. The bundled map library is [Leaflet](https://leafletjs.com/).
