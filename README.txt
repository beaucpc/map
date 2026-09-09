PROPERTYGPS PWA

This is the first Windows/iPhone-friendly version.

FEATURES
- Live high-accuracy GPS position
- One-button MARK HERE waypoint
- Name waypoints
- Map-click property boundary
- Boundary area (hectares)
- Boundary perimeter
- Local browser storage
- JSON export/import
- Home Screen PWA manifest/service worker

IMPORTANT
Phone GPS in a web app requires a secure context (HTTPS) on the deployed site.
For local PC testing, localhost is generally treated as a secure development origin.

QUICK TEST ON WINDOWS
1. Install Python 3 if you don't already have it.
2. Open Command Prompt in this folder.
3. Run:
   python -m http.server 8080
4. On the PC open:
   http://localhost:8080

FOR IPHONE
The app should be hosted over HTTPS. A simple route is GitHub Pages:
- Create a GitHub account/repository
- Upload these files
- Enable GitHub Pages
- Open the resulting HTTPS URL in Safari on iPhone.
- Allow location access.
- Safari -> Share -> Add to Home Screen -> Open as Web App -> Add.

MAP DATA
This starter uses OpenStreetMap tiles. It is not yet a true offline topographic/satellite map system. The next version should use a proper map provider and an explicit offline map download/cache strategy.

NEXT BUILD
- Drag/edit/delete boundary points
- GPS-based boundary recording while walking/driving
- No-shoot-zone polygons
- Waypoint categories and icons
- Distance/bearing to waypoint
- GPS track recording
- Multiple saved properties
- GPX/KML import/export
- Better offline map support
