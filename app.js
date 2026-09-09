const STORAGE_KEY = "propertygps-v1";
let data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {
  name:"My Property", waypoints:[], boundary:[]
};

let currentPosition = null;
let userMarker = null;
let accuracyCircle = null;
let boundaryLine = null;
let boundaryPolygon = null;
let boundaryMarkers = [];
let waypointMarkers = [];
let pendingWaypoint = null;
let boundaryMode = false;

// GPS state
let gpsWatchId = null;
let latestRawPosition = null;
let gpsSamples = [];
let captureTimer = null;
let captureActive = false;
const CAPTURE_MS = 8000;
const MAX_SAMPLE_AGE_MS = 15000;

const map = L.map("map", { zoomControl:false, preferCanvas:true }).setView([-37.8136,144.9631], 10);
L.control.zoom({position:"bottomright"}).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const $ = id => document.getElementById(id);

function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  updateStats();
}

function updateStats(){
  $("propertyName").value = data.name;
  $("waypointCount").textContent = data.waypoints.length;
  const area = polygonAreaM2(data.boundary);
  const perimeter = polygonPerimeterM(data.boundary);
  $("boundaryArea").textContent = `${(area/10000).toFixed(2)} ha`;
  $("boundaryPerimeter").textContent = `${(perimeter/1000).toFixed(2)} km`;
}

function esc(s){
  return String(s).replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function setGPSStatus(text){
  $("status").textContent = text;
}

function updateGPSDisplay(pos){
  const accuracy = Number(pos.accuracy) || 9999;
  $("accuracy").textContent = `Accuracy: ±${Math.round(accuracy)} m`;

  if(captureActive){
    $("hint").textContent =
      `Collecting GPS fixes… ${gpsSamples.length} samples • best ±${Math.round(getBestAccuracy())} m`;
  }
}

function getBestAccuracy(){
  if(!gpsSamples.length) return latestRawPosition?.accuracy || 9999;
  return Math.min(...gpsSamples.map(p => Number(p.accuracy) || 9999));
}

function addGPSSample(coords){
  const now = Date.now();
  const sample = {
    latitude: Number(coords.latitude),
    longitude: Number(coords.longitude),
    accuracy: Number(coords.accuracy) || 9999,
    timestamp: now
  };

  if(!Number.isFinite(sample.latitude) || !Number.isFinite(sample.longitude)) return;

  // Ignore obviously stale fixes.
  if(coords.timestamp && now - coords.timestamp > MAX_SAMPLE_AGE_MS) return;

  // Keep the rolling set small. The best recent fixes are more useful than old ones.
  gpsSamples.push(sample);
  if(gpsSamples.length > 30) gpsSamples.shift();

  updateGPSDisplay(sample);
}

function updateMapPosition(pos){
  const ll=[pos.latitude,pos.longitude];

  if(!userMarker){
    userMarker=L.circleMarker(ll,{
      radius:8,color:"#fff",weight:3,fillColor:"#3b82f6",fillOpacity:1
    }).addTo(map);
  }else{
    userMarker.setLatLng(ll);
  }

  if(!accuracyCircle){
    accuracyCircle=L.circle(ll,{
      radius:pos.accuracy,color:"#3b82f6",weight:1,fillOpacity:.08
    }).addTo(map);
  }else{
    accuracyCircle.setLatLng(ll);
    accuracyCircle.setRadius(pos.accuracy);
  }
}

function handleGPSPosition(pos){
  latestRawPosition = pos.coords;

  // Use the live fix for the moving blue dot.
  currentPosition = pos.coords;
  updateMapPosition(pos.coords);

  const accuracy = Number(pos.coords.accuracy) || 9999;
  setGPSStatus(`GPS ±${Math.round(accuracy)} m`);
  updateGPSDisplay(pos.coords);

  // Store fixes continuously so MARK HERE can use several readings rather than one.
  addGPSSample(pos.coords);
}

function startGPS(){
  if(!navigator.geolocation){
    setGPSStatus("GPS unavailable");
    return;
  }

  if(gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);

  gpsWatchId = navigator.geolocation.watchPosition(
    handleGPSPosition,
    err=>{
      if(err.code===1){
        setGPSStatus("Location permission denied");
      }else{
        setGPSStatus("Waiting for GPS…");
      }
    },
    {
      enableHighAccuracy:true,
      maximumAge:0,
      timeout:10000
    }
  );
}

startGPS();

function centreOnUser(){
  if(!currentPosition){
    alert("Waiting for a GPS position.");
    return;
  }
  map.setView(
    [currentPosition.latitude,currentPosition.longitude],
    Math.max(map.getZoom(),17)
  );
}

$("locateBtn").onclick=centreOnUser;

// Calculate a weighted average of the captured fixes.
// More accurate fixes receive more weight, while a few poor fixes have less influence.
function averageGPS(samples){
  if(!samples.length) return null;

  let weightSum=0, latSum=0, lngSum=0;

  samples.forEach(p=>{
    const a=Math.max(1, Number(p.accuracy)||9999);
    const weight=1/(a*a);
    weightSum+=weight;
    latSum+=p.latitude*weight;
    lngSum+=p.longitude*weight;
  });

  const lat=latSum/weightSum;
  const lng=lngSum/weightSum;

  // Estimate the spread of the captured fixes.
  let weightedSq=0;
  samples.forEach(p=>{
    const d=dist({lat,lng},{lat:p.latitude,lng:p.longitude});
    const a=Math.max(1, Number(p.accuracy)||9999);
    const weight=1/(a*a);
    weightedSq += d*d*weight;
  });

  const spread=Math.sqrt(weightedSq/weightSum);
  const bestAccuracy=Math.min(...samples.map(p=>Number(p.accuracy)||9999));

  // Don't claim an accuracy better than the phone's best reported accuracy.
  const estimatedAccuracy=Math.max(bestAccuracy, spread);

  return {lat,lng,accuracy:estimatedAccuracy,bestAccuracy,spread};
}

function finishWaypointCapture(){
  captureActive=false;

  if(captureTimer){
    clearTimeout(captureTimer);
    captureTimer=null;
  }

  const recent = gpsSamples.filter(p=>Date.now()-p.timestamp <= MAX_SAMPLE_AGE_MS);

  if(!recent.length){
    $("hint").textContent="No usable GPS fixes received.";
    alert("No usable GPS fixes were received. Try again in an open area.");
    return;
  }

  // Prefer good fixes when available, but don't fail completely if the phone
  // is currently reporting poorer accuracy.
  const good = recent.filter(p=>p.accuracy <= 30);
  const samples = good.length >= 3 ? good : recent.slice(-12);

  const result=averageGPS(samples);
  if(!result){
    alert("Unable to calculate a GPS position.");
    return;
  }

  pendingWaypoint={
    lat:result.lat,
    lng:result.lng,
    accuracy:result.accuracy,
    bestAccuracy:result.bestAccuracy,
    sampleCount:samples.length
  };

  $("waypointName").value="";
  $("captureInfo").textContent =
    `GPS position averaged from ${result ? samples.length : 0} fixes. ` +
    `Best reported accuracy ±${Math.round(result.bestAccuracy)} m; ` +
    `estimated spread ±${Math.round(result.spread)} m.`;

  $("waypointDialog").classList.remove("hidden");
  $("hint").textContent="GPS capture complete. Name and save the waypoint.";
  setTimeout(()=>$("waypointName").focus(),50);
}

function captureWaypoint(){
  if(!currentPosition){
    alert("Waiting for a GPS position. Make sure Location Services and Precise Location are enabled.");
    return;
  }

  if(captureActive) return;

  captureActive=true;
  gpsSamples=[];
  $("waypointDialog").classList.add("hidden");
  $("hint").textContent="Collecting GPS fixes for 8 seconds…";
  setGPSStatus("GPS capture in progress…");

  // The watchPosition stream feeds samples continuously.
  // Keep the current fix as a starting point if available.
  addGPSSample(currentPosition);

  captureTimer=setTimeout(finishWaypointCapture,CAPTURE_MS);
}

$("markBtn").onclick=captureWaypoint;

$("cancelWaypoint").onclick=()=>{
  pendingWaypoint=null;
  captureActive=false;
  if(captureTimer){
    clearTimeout(captureTimer);
    captureTimer=null;
  }
  $("waypointDialog").classList.add("hidden");
  $("hint").textContent="Tap MARK HERE to save your current GPS position.";
};

$("saveWaypoint").onclick=()=>{
  if(!pendingWaypoint)return;

  data.waypoints.push({
    id:crypto.randomUUID(),
    name:$("waypointName").value.trim()||"Waypoint",
    lat:pendingWaypoint.lat,
    lng:pendingWaypoint.lng,
    accuracy:pendingWaypoint.accuracy,
    bestAccuracy:pendingWaypoint.bestAccuracy,
    sampleCount:pendingWaypoint.sampleCount,
    created:new Date().toISOString()
  });

  pendingWaypoint=null;
  $("waypointDialog").classList.add("hidden");
  save();
  renderWaypoints();
};

$("boundaryBtn").onclick=()=>{
  boundaryMode=!boundaryMode;
  $("boundaryBtn").textContent=boundaryMode?"✓ FINISH BOUNDARY":"⬡ BOUNDARY";
  $("hint").textContent=boundaryMode
    ?"Tap the map to add boundary points. Tap FINISH when done."
    :"Tap MARK HERE to save your current GPS position.";
  map.getContainer().style.cursor=boundaryMode?"crosshair":"";
};

map.on("click",e=>{
  if(!boundaryMode)return;
  data.boundary.push({lat:e.latlng.lat,lng:e.latlng.lng});
  save();
  renderBoundary();
});

$("clearBoundaryBtn").onclick=()=>{
  if(confirm("Clear the entire property boundary?")){
    data.boundary=[];
    save();
    renderBoundary();
  }
};

// Remove the waypoint geographically nearest to the current GPS position.
// This intentionally has no confirmation so it is a single-click action.
$("removeNearestBtn").onclick=()=>{
  if(!currentPosition){
    alert("Waiting for a GPS position.");
    return;
  }

  if(!data.waypoints.length){
    alert("There are no waypoints to remove.");
    return;
  }

  let nearestIndex=-1;
  let nearestDistance=Infinity;

  data.waypoints.forEach((w,i)=>{
    const d=dist(
      {lat:currentPosition.latitude,lng:currentPosition.longitude},
      {lat:w.lat,lng:w.lng}
    );
    if(d<nearestDistance){
      nearestDistance=d;
      nearestIndex=i;
    }
  });

  if(nearestIndex<0)return;

  const removed=data.waypoints.splice(nearestIndex,1)[0];
  save();
  renderWaypoints();

  $("hint").textContent =
    `Removed "${removed.name}" — ${Math.round(nearestDistance)} m from your GPS position.`;
};

$("saveNameBtn").onclick=()=>{
  data.name=$("propertyName").value.trim()||"My Property";
  save();
};

function renderWaypoints(){
  waypointMarkers.forEach(m=>map.removeLayer(m));
  waypointMarkers=[];

  data.waypoints.forEach(w=>{
    const m=L.marker([w.lat,w.lng]).addTo(map);
    m.bindPopup(
      `<b>${esc(w.name)}</b><br>`+
      `${w.lat.toFixed(6)}, ${w.lng.toFixed(6)}<br>`+
      `Accuracy ±${Math.round(w.accuracy||0)} m`
    );
    waypointMarkers.push(m);
  });
}

function renderBoundary(){
  boundaryMarkers.forEach(m=>map.removeLayer(m));
  boundaryMarkers=[];

  if(boundaryLine)map.removeLayer(boundaryLine);
  if(boundaryPolygon)map.removeLayer(boundaryPolygon);

  const pts=data.boundary.map(p=>[p.lat,p.lng]);

  data.boundary.forEach((p,i)=>{
    const m=L.circleMarker([p.lat,p.lng],{
      radius:6,color:"#2563eb",fillColor:"#60a5fa",fillOpacity:1
    });
    m.bindTooltip(`Boundary ${i+1}`,{direction:"top"});
    m.addTo(map);
    boundaryMarkers.push(m);
  });

  if(pts.length>=2){
    boundaryLine=L.polyline(pts,{
      color:"#2563eb",weight:4,dashArray:"8 6"
    }).addTo(map);
  }

  if(pts.length>=3){
    boundaryPolygon=L.polygon(pts,{
      color:"#2563eb",weight:2,fillColor:"#3b82f6",fillOpacity:.15
    }).addTo(map);
  }

  updateStats();
}

function polygonAreaM2(points){
  if(points.length<3)return 0;
  const R=6378137;
  const lat0=points.reduce((s,p)=>s+p.lat,0)/points.length*Math.PI/180;
  const xy=points.map(p=>[
    R*p.lng*Math.PI/180*Math.cos(lat0),
    R*p.lat*Math.PI/180
  ]);
  let a=0;
  for(let i=0;i<xy.length;i++){
    let j=(i+1)%xy.length;
    a+=xy[i][0]*xy[j][1]-xy[j][0]*xy[i][1];
  }
  return Math.abs(a/2);
}

function dist(a,b){
  const R=6371008.8;
  const p1=a.lat*Math.PI/180;
  const p2=b.lat*Math.PI/180;
  const dp=(b.lat-a.lat)*Math.PI/180;
  const dl=(b.lng-a.lng)*Math.PI/180;
  const x=Math.sin(dp/2)**2+
    Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

function polygonPerimeterM(points){
  if(points.length<2)return 0;
  let s=0;
  for(let i=0;i<points.length;i++){
    s+=dist(points[i],points[(i+1)%points.length]);
  }
  return s;
}

$("exportBtn").onclick=()=>{
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=(data.name||"property").replace(/[^a-z0-9_-]+/gi,"_")+".json";
  a.click();
  URL.revokeObjectURL(a.href);
};

$("importInput").onchange=e=>{
  const f=e.target.files[0];
  if(!f)return;

  const r=new FileReader();

  r.onload=()=>{
    try{
      const imported=JSON.parse(r.result);
      if(!imported.waypoints||!imported.boundary)throw 0;
      data=imported;
      save();
      renderWaypoints();
      renderBoundary();
    }catch{
      alert("That file is not a valid PropertyGPS file.");
    }
  };

  r.readAsText(f);
  e.target.value="";
};

updateStats();
renderWaypoints();
renderBoundary();

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(()=>{});
}
