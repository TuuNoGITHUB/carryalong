# CarryAlong

[Open CarryAlong](https://tuunogithub.github.io/carryalong/)

CarryAlong is a mobile web demo for matching pocket-sized favors with trips that commuters already plan to make between HKUST and the MTR. It was built as a COMP1945 group project.

Try **Campus envelope** to find a match, reserve a trip with demo points, and confirm pickup and delivery using a handoff pass. **Nearby stop** can suggest a starting stop using a one-time location reading. You can also choose a stop manually or use the sample location.

Trips, travel times, handoffs, and points are simulated. The app processes location coordinates in the browser and does not store them. Demo activity is saved in your browser.

## Run locally

Open `index.html` in a browser. The bundled page includes all runtime assets. To rebuild it from the source files, run `node build.mjs`.
