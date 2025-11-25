import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Scatter, ComposedChart, AreaChart, Area, ReferenceLine, ReferenceArea, ScatterChart
} from 'recharts';
import {
  Upload, FileText, Activity, Plus, Search, ChevronRight, Save,
  TrendingUp, Settings, MapPin, Info, Edit2, Check, ArrowRight, Database, Layers, Trash2, Box, Grid, Maximize2, Calculator, Copy, RefreshCw, FileSpreadsheet, X, Droplet, Thermometer, Anchor, ChevronDown, ChevronUp, AlertTriangle, Circle, MoreHorizontal, Truck, ArrowUp, ArrowDown, Download, PlayCircle, Briefcase, Share2, MousePointer,
  Loader2, AlertCircle
} from 'lucide-react';

// --- FIREBASE IMPORTS ---
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query
} from 'firebase/firestore';
import {
  signInAnonymously, signInWithCustomToken, onAuthStateChanged
} from 'firebase/auth';

// --- LOCAL IMPORTS ---
import { auth, db, appId } from './firebaseConfig';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// --- ARCHER BRAND COLORS ---
const COLORS = {
  slate: '#37424A',
  yellow: '#FFC82E',
  teal: '#00A99D',
  background: '#F4F4F4',
  white: '#FFFFFF',
  textMain: '#37424A',
  textLight: '#7F8C8D',
  grid: '#E5E7EB',
  danger: '#EF4444',
  success: '#10B981'
};

// --- HELPER: MATH & PHYSICS ---
const degToRad = (deg) => deg * (Math.PI / 180);

const interpolate = (x, xArray, yArray) => {
  if (!xArray || xArray.length === 0) return 0;
  for (let i = 0; i < xArray.length - 1; i++) {
    if (x >= xArray[i] && x <= xArray[i + 1]) {
      const ratio = (x - xArray[i]) / (xArray[i + 1] - xArray[i]);
      return yArray[i] + ratio * (yArray[i + 1] - yArray[i]);
    }
  }
  if (x < xArray[0]) return yArray[0];
  if (x > xArray[xArray.length - 1]) return yArray[yArray.length - 1];
  return 0;
};

const calculateTrajectory = (surveyPoints) => {
  if (!surveyPoints || surveyPoints.length === 0) return [];

  let trajectory = [];
  let N = 0, E = 0, TVD = 0;

  // Start point (Surface)
  trajectory.push({ x: 0, y: 0, z: 0, md: 0, tvd: 0 });

  for (let i = 1; i < surveyPoints.length; i++) {
    const p1 = surveyPoints[i - 1];
    const p2 = surveyPoints[i];

    if (p2.md <= p1.md) continue;

    const dm = p2.md - p1.md;
    const I1 = degToRad(p1.inc);
    const I2 = degToRad(p2.inc);
    const A1 = degToRad(p1.azi);
    const A2 = degToRad(p2.azi);

    // Minimum Curvature Method
    const dl = Math.acos(Math.max(-1, Math.min(1, Math.cos(I2 - I1) - Math.sin(I1) * Math.sin(I2) * (1 - Math.cos(A2 - A1)))));

    let RF = 1;
    if (dl > 0.0001) {
      RF = (2 / dl) * Math.tan(dl / 2);
    }

    const dN = (dm / 2) * (Math.sin(I1) * Math.cos(A1) + Math.sin(I2) * Math.cos(A2)) * RF;
    const dE = (dm / 2) * (Math.sin(I1) * Math.sin(A1) + Math.sin(I2) * Math.sin(A2)) * RF;
    const dTVD = (dm / 2) * (Math.cos(I1) + Math.cos(I2)) * RF;

    N += dN;
    E += dE;
    TVD += dTVD;

    trajectory.push({ x: E, y: -TVD, z: -N, md: p2.md, tvd: TVD });
  }
  return trajectory;
};

const calculateIDFromODWeight = (od, weight, unitOD, unitWeight, unitID) => {
  if (!od || !weight || od <= 0 || weight <= 0) return null;
  let odInch = unitOD === 'in' ? od : od / 2.54;
  let wLbFt = unitWeight === 'lb/ft' ? weight : weight * 0.671969;
  let idSq = (odInch * odInch) - (wLbFt / 2.67);
  if (idSq > 0) {
    let idInch = Math.sqrt(idSq);
    let result = unitID === 'in' ? idInch : idInch * 2.54;
    return parseFloat(result.toFixed(3));
  }
  return null;
};

// --- HELPER: EXPORT TO CTSPROJ (XML) ---
const fmt = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? "0.0000" : n.toFixed(4);
};

const exportToComtrac = (well, run) => {
  const traj = calculateTrajectory(well.survey);
  const maxDepth = Math.max(...well.survey.map(p => p.md), 0);
  const safeScenarioName = run.bha?.name || "New Run";

  const scenarioMap = { 'Shut-in': 'ShutIn', 'Flow': 'Flowing', 'Injection': 'Injection' };
  const fluidMovement = scenarioMap[run.fluids?.scenario] || 'ShutIn';

  const gas = run.fluids?.list?.find(f => f.type === 'Gass') || { sg: 0, percent: 0 };
  const oil = run.fluids?.list?.find(f => f.type === 'Olje') || { sg: 0, percent: 0 };
  const water = run.fluids?.list?.find(f => f.type === 'Vann') || { sg: 0, percent: 0 };

  let xml = `<?xml version="1.0" encoding="utf-8"?>
<ComTracProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <ProjectFileName>C:\\Users\\User\\Documents\\ComTrac Projects\\${safeScenarioName}.ctsproj</ProjectFileName>
  <ProjectVersion>1.0.0.43</ProjectVersion>
  <WellTrajectory>
    <Items>
`;

  // Trajectory Items
  const trajMap = new Map(traj.map(t => [t.md, t]));
  well.survey.forEach((p) => {
    const calc = trajMap.get(p.md) || { x: 0, y: 0, z: 0, tvd: 0 };
    xml += `      <WellTrajectoryItem>
        <MD>${fmt(p.md)}</MD>
        <Incl>${fmt(degToRad(p.inc))}</Incl>
        <Az>${fmt(degToRad(p.azi))}</Az>
        <TVD>${fmt(calc.tvd)}</TVD>
        <North>${fmt(-calc.z)}</North>
        <East>${fmt(calc.x)}</East>
        <Radius>0.0000</Radius>
        <VSect>0.0000</VSect>
        <DLS>0.0000</DLS>
      </WellTrajectoryItem>
`;
  });

  xml += `    </Items>
  </WellTrajectory>
  <Scenarios>
    <Scenario>
      <Id>${Math.floor(Math.random() * 100000)}</Id>
      <Name>${safeScenarioName}</Name>
      <Architecture>
        <MaxDepth>${fmt(maxDepth)}</MaxDepth>
        <CasingSections>
`;

  if (well.architecture && well.architecture.length > 0) {
    well.architecture.forEach(sec => {
      const radius = (parseFloat(sec.id) || 0) / 200.0;
      xml += `          <CasingSection>
            <ShoeDepth>${fmt(sec.end)}</ShoeDepth>
            <DepthFrom>${fmt(sec.start)}</DepthFrom>
            <CasingRadius>${fmt(radius)}</CasingRadius> 
            <MuRodRIHFactor>${fmt(sec.fricRodRIH || 1.0)}</MuRodRIHFactor>
            <MuRodPOHFactor>${fmt(sec.fricRodPOOH || 1.0)}</MuRodPOHFactor>
            <MuToolRIHFactor>${fmt(sec.fricToolRIH || 0.3)}</MuToolRIHFactor>
            <MuToolPOHFactor>${fmt(sec.fricToolPOOH || 0.3)}</MuToolPOHFactor>
          </CasingSection>
`;
    });
  } else {
    xml += `          <CasingSection>
            <ShoeDepth>${fmt(maxDepth)}</ShoeDepth>
            <DepthFrom>0.0000</DepthFrom>
            <CasingRadius>0.1000</CasingRadius>
            <MuRodRIHFactor>0.2500</MuRodRIHFactor>
            <MuRodPOHFactor>0.2500</MuRodPOHFactor>
            <MuToolRIHFactor>0.2500</MuToolRIHFactor>
            <MuToolPOHFactor>0.2500</MuToolPOHFactor>
          </CasingSection>
`;
  }

  xml += `        </CasingSections>
      </Architecture>
      <WellConditions>
        <SurfacePressure>${fmt((parseFloat(run.fluids?.whp) || 0) * 100000)}</SurfacePressure>
        <TemperatureProfile>
          <ProfileName>Default</ProfileName>
          <TemperatureData>
            <TemperatureTable_MD_>
`;
  (run.temps || []).forEach(t => xml += `              <double>${fmt(t.md)}</double>\n`);
  xml += `            </TemperatureTable_MD_>
            <TemperatureTable_Temperatures_>
`;
  // Temp C -> K
  (run.temps || []).forEach(t => xml += `              <double>${fmt(parseFloat(t.temp) + 273.15)}</double>\n`);
  xml += `            </TemperatureTable_Temperatures_>
          </TemperatureData>
        </TemperatureProfile>
      </WellConditions>
      <Fluids>
        <FluidMovement>${fluidMovement}</FluidMovement>
        <GasFlowRate>0.0000</GasFlowRate>
        <GasFraction>${fmt(gas.percent / 100)}</GasFraction>
        <OilFlowRate>0.0000</OilFlowRate>
        <OilFraction>${fmt(oil.percent / 100)}</OilFraction>
        <WaterFlowRate>0.0000</WaterFlowRate>
        <WaterFraction>${fmt(water.percent / 100)}</WaterFraction>
        <GasFluidDensity>${fmt(gas.sg * 1000)}</GasFluidDensity>
        <OilFluidDensity>${fmt(oil.sg * 1000)}</OilFluidDensity>
        <WaterFluidDensity>${fmt(water.sg * 1000)}</WaterFluidDensity>
        <IsFluidPipeFrictionEstimation>false</IsFluidPipeFrictionEstimation>
        <DownholePressureAtMD>101325.0000</DownholePressureAtMD>
        <MDForDownholePressure>${fmt(maxDepth)}</MDForDownholePressure>
        <DarcyFrictionFactorGuess>0.1000</DarcyFrictionFactorGuess>
        <DarcyFrictionFactorUsed>0.0000</DarcyFrictionFactorUsed>
      </Fluids>
      <PVTData />
      <Rod>
        <Radius>${fmt((run.rod?.diameter || 1.2) / 200)}</Radius>
        <LinearMass>${fmt(run.rod?.weight || 0.225)}</LinearMass>
        <YoungModulus>${fmt((run.rod?.youngs || 125) * 1e9)}</YoungModulus>
        <RodFluidFrictionFactor>${fmt(run.rod?.fluidFric || 0.04)}</RodFluidFrictionFactor>
        <RodRIHFrictionFactor>${fmt(run.rod?.rihFric || 0.2)}</RodRIHFrictionFactor>
        <RodPOOHFrictionFactor>${fmt(run.rod?.poohFric || 0.2)}</RodPOOHFrictionFactor>
      </Rod>
      <StuffingBox>
        <StuffingContactForce>${fmt(run.pce?.force || 100)}</StuffingContactForce>
        <StuffingFriction>${fmt(run.pce?.friction || 0.2)}</StuffingFriction>
      </StuffingBox>
      <ToolString>
        <ToolStringElements>
`;

  if (run.bha?.tools) {
    run.bha.tools.forEach(tool => {
      const rad = (tool.od || 0) / 200;
      xml += `          <ToolStringElement>
            <Name>${tool.name || 'Tool'}</Name>
            <Length>${fmt(tool.length)}</Length>
            <Radius>${fmt(rad)}</Radius>
            <Mass>${fmt(tool.weight)}</Mass>
            <IsTractor>${tool.isTractor ? 'true' : 'false'}</IsTractor>
            <TractionForce>${fmt(tool.tractorForce || 0)}</TractionForce>
            <ToolFluidFrictionFactor>${fmt(tool.fricFluid || 0.4)}</ToolFluidFrictionFactor>
            <ToolRIHFrictionFactor>${fmt(tool.fricRIH || 1.0)}</ToolRIHFrictionFactor>
            <ToolPOOHFrictionFactor>${fmt(tool.fricPOOH || 1.0)}</ToolPOOHFrictionFactor>
            <StiffUpperNode>false</StiffUpperNode>
            <FrictionReductionFactor>0.0000</FrictionReductionFactor>
            <HasCentralizer>${tool.isCentralizer ? 'true' : 'false'}</HasCentralizer>
            <CentralizerMaxOD>${fmt(tool.centMaxOD || 0)}</CentralizerMaxOD>
            <CentralizerAppliedForce>${fmt(tool.centForce || 0)}</CentralizerAppliedForce>
          </ToolStringElement>
`;
    });
  }

  xml += `        </ToolStringElements>
      </ToolString>
      <TargetMD>${fmt(run.general?.targetDepth || maxDepth)}</TargetMD>
      <SimulationStep>10</SimulationStep>
      <BucklingCheckStep>10</BucklingCheckStep>
    </Scenario>
  </Scenarios>
  <Report>
    <Info />
    <Well>
      <Description>Generated by Archer Comtrac Tuner</Description>
    </Well>
    <Scenarios>
        <ReportScenario>
            <Description>${safeScenarioName}</Description>
        </ReportScenario>
    </Scenarios>
    <AllScenarios />
  </Report>
</ComTracProject>`;

  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${well.name}_${safeScenarioName.replace(/\s+/g, '_')}.ctsproj`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// --- HELPER: PARSING SURVEY ---
const parseSurveyData = (text, config) => {
  if (!text) return [];
  const lines = text.split('\n');
  const parsed = [];
  const { startLine, delimiter, colMD, colInc, colAzi, unitMultiplier, thousandSep } = config;
  const effectiveStartLine = Math.max(1, startLine);
  for (let i = effectiveStartLine - 1; i < lines.length; i++) {
    if (lines[i] === undefined) continue;
    let line = lines[i].trim();
    if (!line) continue;
    let parts;
    if (delimiter === 'auto') parts = line.split(/[\t,; ]+/);
    else if (delimiter === 'tab') parts = line.split('\t');
    else if (delimiter === ',') parts = line.split(',');
    else parts = line.split(delimiter);
    const rawMD = parts[colMD - 1];
    const rawInc = parts[colInc - 1];
    const rawAzi = parts[colAzi - 1];
    if (rawMD !== undefined && rawInc !== undefined) {
      const cleanFloat = (str) => {
        if (!str) return 0;
        let s = str.toString().replace(/^"|"$/g, '');
        if (thousandSep === 'space') s = s.replace(/\s/g, '');
        else if (thousandSep === '.') s = s.replace(/\./g, '');
        else if (thousandSep === ',') s = s.replace(/,/g, '');
        if (thousandSep !== ',') s = s.replace(',', '.');
        const val = parseFloat(s);
        return isNaN(val) ? 0 : val;
      };
      const md = cleanFloat(rawMD) * unitMultiplier;
      const inc = cleanFloat(rawInc);
      const azi = cleanFloat(rawAzi);
      if (!isNaN(md) && md >= 0) parsed.push({ md: parseFloat(md.toFixed(2)), inc, azi });
    }
  }
  return parsed;
};

// --- HELPER: PARSING SIMULATION CSV ---
const parseSimulationCSV = (text) => {
  const lines = text.split('\n');
  const data = [];
  let startIdx = 1;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    if (/^\d/.test(lines[i].trim())) {
      startIdx = i;
      break;
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/[\t,;]+/);
    const md = parseFloat(parts[0]);
    const rih = parseFloat(parts[1]);
    const pooh = parseFloat(parts[2]);
    if (!isNaN(md)) {
      data.push({ md, rih: isNaN(rih) ? null : rih, pooh: isNaN(pooh) ? null : pooh });
    }
  }
  return data.sort((a, b) => a.md - b.md);
};

// --- COMPONENT: 3D WELL VIEWER (INTERACTIVE) ---
const WellBore3D = ({ points, architecture }) => {
  const containerRef = useRef(null);
  const [libLoaded, setLibLoaded] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);

  useEffect(() => {
    // With local imports, we don't need to load scripts dynamically
    setLibLoaded(true);
  }, []);

  useEffect(() => {
    if (!libLoaded || !containerRef.current || points.length < 2) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    const camera = new THREE.PerspectiveCamera(45, w / h, 1, 50000);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    points.forEach(p => {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    });
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

    camera.position.set(centerX + maxDim * 1.5, centerY + maxDim * 0.5, centerZ + maxDim * 1.5);
    camera.lookAt(centerX, centerY, centerZ);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(centerX, centerY, centerZ);
    controls.update();

    const grid = new THREE.GridHelper(10000, 100, 0xdddddd, 0xeeeeee);
    grid.position.y = minY - 100;
    scene.add(grid);
    const axes = new THREE.AxesHelper(1000);
    scene.add(axes);

    // Points geometry for Raycasting
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    points.forEach(p => vertices.push(p.x, p.y, p.z));
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    const material = new THREE.LineBasicMaterial({ color: 0x37424A, linewidth: 2 });
    const line = new THREE.Line(geometry, material);
    scene.add(line);

    // Raycaster setup
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 5; // Tolerance for clicking line
    const mouse = new THREE.Vector2();

    const onMouseMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(line);

      if (intersects.length > 0) {
        const intersect = intersects[0];
        // Map intersect index to points array (approximate)
        const idx = Math.floor(intersect.index); // closest point index
        if (points[idx]) {
          const p = points[idx];
          // Find ID from architecture
          const section = architecture?.find(s => p.md >= s.start && p.md <= s.end);
          setHoverInfo({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            md: p.md,
            tvd: p.tvd,
            id: section ? section.id : '-'
          });
        }
      } else {
        setHoverInfo(null);
      }
    };

    renderer.domElement.addEventListener('mousemove', onMouseMove);

    let animationId;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const newW = containerRef.current.clientWidth;
      const newH = containerRef.current.clientHeight;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(animationId);
      renderer.dispose();
    };
  }, [libLoaded, points, architecture]);

  if (!libLoaded) return <div className="h-full flex items-center justify-center text-gray-400">Laster 3D motor...</div>;

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} style={{ width: '100%', height: '100%', cursor: 'crosshair' }} />
      {hoverInfo && (
        <div
          className="absolute bg-white/90 border border-gray-300 p-2 rounded shadow-lg text-xs pointer-events-none z-10"
          style={{ left: hoverInfo.x + 15, top: hoverInfo.y + 15 }}
        >
          <div className="font-bold text-[#37424A] mb-1">Brønn Data</div>
          <div><span className="font-bold">MD:</span> {hoverInfo.md.toFixed(1)} m</div>
          <div><span className="font-bold">TVD:</span> {hoverInfo.tvd.toFixed(1)} m</div>
          <div><span className="font-bold">ID:</span> {hoverInfo.id}"</div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 text-[10px] text-gray-400 bg-white/80 px-2 py-1 rounded pointer-events-none">
        Hovre over linjen for detaljer. Klikk & Dra for å rotere.
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---
export default function App() {
  const [view, setView] = useState('dashboard');
  const [wells, setWells] = useState([]);
  const [activeWell, setActiveWell] = useState(null);
  const [editingWell, setEditingWell] = useState(null);
  const [editingRun, setEditingRun] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // --- FIREBASE AUTH & DATA FETCHING ---
  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        // Removed __initial_auth_token check for local dev, or keep if needed but likely anonymous for now
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Autentisering feilet:", err);
        if (mounted) setError(err.message);
      }
    };

    initAuth();

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (mounted) {
        setUser(currentUser);
        if (currentUser) {
          setLoading(false);
        }
      }
    });
    return () => {
      mounted = false;
      unsubscribeAuth();
    };
  }, []);

  // Listen for Data (Wells)
  useEffect(() => {
    if (!user) return;

    const q = collection(db, 'artifacts', appId, 'users', user.uid, 'wells');

    const unsubscribeData = onSnapshot(q, (snapshot) => {
      const loadedWells = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setWells(loadedWells);

      if (activeWell) {
        const updatedActive = loadedWells.find(w => w.id === activeWell.id);
        if (updatedActive) setActiveWell(updatedActive);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error loading wells:", error);
    });

    return () => unsubscribeData();
  }, [user, activeWell?.id]);


  const navigateTo = (newView, well = null) => {
    if (well) setActiveWell(well);
    setView(newView);
  };

  // --- DATABASE OPERATIONS ---

  const handleSaveWell = async (wellData) => {
    if (!user) return;
    try {
      const wellsCollection = collection(db, 'artifacts', appId, 'users', user.uid, 'wells');
      const docRef = doc(wellsCollection, wellData.id);
      await setDoc(docRef, wellData);
      setEditingWell(null);
      setView('dashboard');
    } catch (e) {
      console.error("Error saving well:", e);
      alert("Kunne ikke lagre brønn. Sjekk konsoll for feil.");
    }
  };

  const handleDeleteWell = async (id) => {
    if (!user) return;
    if (window.confirm('Er du sikker på at du vil slette denne brønnen? Dette kan ikke angres.')) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'wells', id));
        if (activeWell?.id === id) setActiveWell(null);
      } catch (e) {
        console.error("Error deleting well:", e);
      }
    }
  };

  const handleEditWell = (well) => {
    setEditingWell(well);
    setView('create');
  };

  const cancelEdit = () => {
    setEditingWell(null);
    setView('dashboard');
  };

  const handleSaveRun = async (wellId, runData) => {
    if (!user) return;
    const wellToUpdate = wells.find(w => w.id === wellId);
    if (!wellToUpdate) return;

    let newJobs;
    const timestamp = new Date().toISOString().split('T')[0];
    if (editingRun) {
      newJobs = (wellToUpdate.jobs || []).map(j => j.id === editingRun.id ? { ...runData, id: editingRun.id, date: timestamp } : j);
    } else {
      newJobs = [...(wellToUpdate.jobs || []), { id: Math.random().toString(), date: timestamp, ...runData }];
    }

    try {
      const wellRef = doc(db, 'artifacts', appId, 'users', user.uid, 'wells', wellId);
      await updateDoc(wellRef, { jobs: newJobs });
      setEditingRun(null);
      if (!editingRun) setView('viewWell');
    } catch (e) {
      console.error("Error saving run:", e);
    }
  };

  const handleDeleteRun = async (wellId, runId) => {
    if (!user) return;
    if (window.confirm('Er du sikker på at du vil slette dette runnet?')) {
      const wellToUpdate = wells.find(w => w.id === wellId);
      if (!wellToUpdate) return;

      const newJobs = (wellToUpdate.jobs || []).filter(j => j.id !== runId);

      try {
        const wellRef = doc(db, 'artifacts', appId, 'users', user.uid, 'wells', wellId);
        await updateDoc(wellRef, { jobs: newJobs });
      } catch (e) {
        console.error("Error deleting run:", e);
      }
    }
  };

  const handleEditRun = (run) => {
    setEditingRun(run);
    setView('runWorkflow');
  };

  const handleCopyRun = async (wellId, run) => {
    if (!user) return;
    const wellToUpdate = wells.find(w => w.id === wellId);
    if (!wellToUpdate) return;

    const newRun = { ...run, id: Math.random().toString(), date: new Date().toISOString().split('T')[0], bha: { ...run.bha, name: `Kopi av ${run.bha?.name || 'Run'}` } };
    const newJobs = [...(wellToUpdate.jobs || []), newRun];

    try {
      const wellRef = doc(db, 'artifacts', appId, 'users', user.uid, 'wells', wellId);
      await updateDoc(wellRef, { jobs: newJobs });
    } catch (e) {
      console.error("Error copying run:", e);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-red-50 p-4 text-center font-sans">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-red-700 mb-2">Tilkoblingsfeil</h2>
        <p className="text-red-600 font-mono text-sm bg-red-100 p-2 rounded max-w-md break-all">
          {error}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
        >
          Prøv igjen
        </button>
      </div>
    );
  }

  if (loading && !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 font-sans">
        <Loader2 className="w-8 h-8 text-[#37424A] animate-spin mb-2" />
        <p className="text-slate-500 font-medium">Starter Comtrac Tuner...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans text-slate-800 bg-[#F4F4F4]">
      <header className="bg-[#37424A] text-white shadow-md sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => navigateTo('dashboard')}>
            <img src="https://storage.googleapis.com/files_webpage/Archer/Archer%20A_Grey_.png" alt="Archer Logo" className="h-8 w-auto object-contain" />
            <div>
              <h1 className="text-lg font-bold tracking-wide leading-tight">COMTRAC <span className="text-[#FFC82E]">TUNER</span></h1>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">Simulering & Verifikasjon</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="opacity-70 hidden md:inline">Admin Portal</span>
            {user ? (
              <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center border border-green-500 font-bold text-xs" title={`Logget inn: ${user.uid.substr(0, 4)}...`}>OK</div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center border border-gray-500 font-bold text-xs animate-pulse">...</div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 h-[calc(100vh-64px)]">
        {view === 'dashboard' && <Dashboard onNewWell={() => { setEditingWell(null); navigateTo('create'); }} wells={wells} onViewWell={(w) => navigateTo('viewWell', w)} onDeleteWell={handleDeleteWell} onEditWell={handleEditWell} />}
        {view === 'create' && <CreateWellWizard onCancel={cancelEdit} onSave={handleSaveWell} initialData={editingWell} />}
        {view === 'viewWell' && <WellView well={activeWell} onBack={() => navigateTo('dashboard')} onNewRun={() => { setEditingRun(null); navigateTo('runWorkflow', activeWell); }} onEditRun={handleEditRun} onCopyRun={(r) => handleCopyRun(activeWell.id, r)} onDeleteRun={(id) => handleDeleteRun(activeWell.id, id)} />}
        {view === 'runWorkflow' && <RunWorkflow well={activeWell} onCancel={() => { setEditingRun(null); navigateTo('viewWell', activeWell); }} onSave={handleSaveRun} initialRun={editingRun} />}
      </main>
    </div>
  );
}

// --- NEW FEATURE: RUN WORKFLOW (CONTAINER) ---
function RunWorkflow({ well, onCancel, onSave, initialRun }) {
  const [activeTab, setActiveTab] = useState('config');
  const [runData, setRunData] = useState(initialRun || {
    general: { goal: '', targetDepth: '' },
    pce: { type: '', force: 0, friction: 0 },
    fluids: { scenario: 'Shut-in', whp: 0, list: [{ type: 'Gass', sg: 0.1, percent: 33 }, { type: 'Olje', sg: 0.85, percent: 33 }, { type: 'Vann', sg: 1.05, percent: 34 }] },
    temps: [{ md: 0, tvd: 0, temp: 15 }, { md: Math.max(...well.survey.map(p => p.md), 0), tvd: 0, temp: 80 }],
    rod: { diameter: 1.2, weight: 0.225, youngs: 125.0, rihFric: 0.2, poohFric: 0.2, fluidFric: 0.04, units: {} },
    bha: { name: '', tools: [] },
    simulations: { fileStandard: null, fileTractor: null, filePooh: null, tractorDepth: 0 }
  });

  const handleSaveLocal = (section, data) => {
    const newData = { ...runData, [section]: data };
    setRunData(newData);
    // If we are editing an existing run, auto-save to global state
    if (initialRun) {
      onSave(well.id, newData);
    }
  };

  const handleSimulationSave = (simData) => {
    const newData = { ...runData, simulations: simData };
    setRunData(newData);
    if (initialRun) onSave(well.id, newData);
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onCancel} className="text-sm font-bold text-gray-500 hover:text-[#37424A] flex items-center gap-2"><ArrowRight className="rotate-180" size={16} /> Tilbake til {well.name}</button>
        <div className="flex bg-white rounded-lg shadow-sm p-1 border border-gray-200">
          <button onClick={() => setActiveTab('config')} className={`px-4 py-2 text-sm font-bold rounded flex items-center gap-2 ${activeTab === 'config' ? 'bg-[#37424A] text-white' : 'text-gray-500 hover:bg-gray-50'}`}><Settings size={16} /> Konfigurasjon</button>
          <button onClick={() => setActiveTab('sim')} className={`px-4 py-2 text-sm font-bold rounded flex items-center gap-2 ${activeTab === 'sim' ? 'bg-[#37424A] text-white' : 'text-gray-500 hover:bg-gray-50'}`}><Activity size={16} /> Simuleringsbygger</button>
          <button onClick={() => setActiveTab('portal')} className={`px-4 py-2 text-sm font-bold rounded flex items-center gap-2 ${activeTab === 'portal' ? 'bg-[#37424A] text-white' : 'text-gray-500 hover:bg-gray-50'}`}><Share2 size={16} /> Felt Portal</button>
        </div>
        {/* Placeholder for symmetry */}
        <div className="w-32"></div>
      </div>

      <div className="flex-grow bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        {activeTab === 'config' && (
          <RunConfiguration
            well={well}
            initialRun={runData} // Pass current state so we don't lose progress when switching tabs
            onSave={(wid, data) => { onSave(wid, data); }} // Main save button inside config
            onCancel={onCancel}
            embedded={true} // New prop to hide headers inside component if needed
          />
        )}
        {activeTab === 'sim' && (
          <SimulationBuilder
            runData={runData}
            onUpdate={handleSimulationSave}
            well={well}
          />
        )}
        {activeTab === 'portal' && (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <Share2 size={64} className="mb-4 opacity-20" />
            <h2 className="text-xl font-bold text-gray-600">Feltingeniør Portal</h2>
            <p>Kommer snart. Her vil du kunne sende pakken direkte til feltet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- NEW COMPONENT: SIMULATION BUILDER ---
function SimulationBuilder({ runData, onUpdate, well }) {
  const [files, setFiles] = useState({
    rih: runData.simulations?.fileStandard || null,
    tractor: runData.simulations?.fileTractor || null,
    pooh: runData.simulations?.filePooh || null
  });
  const [tractorDepth, setTractorDepth] = useState(runData.simulations?.tractorDepth || 0);
  const [chartData, setChartData] = useState([]);

  // File Parsers logic
  const handleFileUpload = (key, file) => {
    if (!file) {
      const newFiles = { ...files, [key]: null };
      setFiles(newFiles);
      onUpdate({ ...runData.simulations, fileStandard: newFiles.rih, fileTractor: newFiles.tractor, filePooh: newFiles.pooh });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseSimulationCSV(e.target.result);
      const newFiles = { ...files, [key]: parsed };
      setFiles(newFiles);
      // Save huge data array to parent state might be heavy, but necessary for tab switching
      onUpdate({ ...runData.simulations, fileStandard: newFiles.rih, fileTractor: newFiles.tractor, filePooh: newFiles.pooh, tractorDepth });
    };
    reader.readAsText(file);
  };

  // Data Merging Logic
  useEffect(() => {
    if (!files.rih) {
      setChartData([]);
      return;
    }
    // Logic 1: RIH Standard Only
    // Use RIH from File 1. Use POOH from File 1.
    let merged = files.rih.map(p => ({
      md: p.md,
      rih_standard: p.rih, // Always plot standard RIH
      rih_tractor: null,
      pooh: p.pooh
    }));

    // Logic 2 & 3: Tractor Handling
    if (files.tractor && tractorDepth > 0) {
      merged = merged.map(p => {
        let newItem = { ...p };

        // RIH Logic: Use Standard until tractorDepth, then Tractor data
        if (p.md >= tractorDepth) {
          // Find corresponding point in tractor file
          const tractorPoint = files.tractor.find(tp => Math.abs(tp.md - p.md) < 0.5); // Simple proximity match
          if (tractorPoint) {
            newItem.rih_standard = null; // Stop showing standard line
            newItem.rih_tractor = tractorPoint.rih; // Start showing tractor line
            // If Logic 2 (Tractor file has POOH but no separate POOH file)
            // And Logic 3 (Separate POOH file exists) handled below
            if (!files.pooh) {
              newItem.pooh = tractorPoint.pooh; // Override POOH with tractor file's POOH
            }
          }
        }
        return newItem;
      });
    }

    // Logic 3: Dedicated POOH File
    if (files.pooh) {
      merged = merged.map(p => {
        const poohPoint = files.pooh.find(pp => Math.abs(pp.md - p.md) < 0.5);
        return { ...p, pooh: poohPoint ? poohPoint.pooh : p.pooh };
      });
    }

    setChartData(merged);

  }, [files, tractorDepth]);

  return (
    <div className="flex h-full">
      {/* Sidebar with Parameters */}
      <div className="w-64 bg-slate-50 border-r border-gray-200 overflow-y-auto p-4 shrink-0">
        <h3 className="font-bold text-[#37424A] mb-4 flex items-center gap-2"><Briefcase size={16} /> Run Parameter</h3>
        <div className="space-y-4 text-xs">
          <div className="bg-white p-2 rounded border border-gray-200">
            <div className="font-bold text-gray-500 mb-1">Generelt</div>
            <div className="text-[#37424A] truncate" title={runData.general?.goal}>{runData.general?.goal || '-'}</div>
            <div className="text-gray-400 mt-1">Mål: {runData.general?.targetDepth} m</div>
          </div>
          <div className="bg-white p-2 rounded border border-gray-200">
            <div className="font-bold text-gray-500 mb-1">PCE</div>
            <div>Type: {runData.pce?.type}</div>
            <div>Kraft: {runData.pce?.force} kg</div>
            <div>Friksjon: {runData.pce?.friction}</div>
          </div>
          <div className="bg-white p-2 rounded border border-gray-200">
            <div className="font-bold text-gray-500 mb-1">Væske</div>
            <div>Scenario: {runData.fluids?.scenario}</div>
            <div>WHP: {runData.fluids?.whp} bar</div>
            <div className="mt-1 space-y-0.5">
              {runData.fluids?.list?.map((f, i) => f.percent > 0 && <div key={i}>{f.type}: {f.sg} SG ({f.percent}%)</div>)}
            </div>
          </div>
          <div className="bg-white p-2 rounded border border-gray-200">
            <div className="font-bold text-gray-500 mb-1">Rod</div>
            <div>OD: {runData.rod?.diameter} {runData.rod?.units?.diameter || 'cm'}</div>
            <div>Vekt: {runData.rod?.weight} {runData.rod?.units?.weight || 'kg/m'}</div>
          </div>
          <div className="bg-white p-2 rounded border border-gray-200">
            <div className="font-bold text-gray-500 mb-1">BHA</div>
            <div>Navn: {runData.bha?.name}</div>
            <div>Verktøy: {runData.bha?.tools?.length || 0} stk</div>
            <div className="mt-1 text-gray-400">Total lengde: {runData.bha?.tools?.reduce((a, b) => a + (b.length || 0), 0).toFixed(2)} m</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-grow p-6 flex flex-col overflow-hidden">
        <div className="grid grid-cols-3 gap-4 mb-4 shrink-0">
          <FileUploader label="1. RIH (Standard)" color="border-gray-300" hasData={!!files.rih} onUpload={(f) => handleFileUpload('rih', f)} />
          <div className="space-y-2">
            <FileUploader label="2. RIH + Tractor (Opsjon)" color="border-[#FFC82E]" hasData={!!files.tractor} onUpload={(f) => handleFileUpload('tractor', f)} />
            {files.tractor && (
              <div className="flex items-center gap-2 bg-yellow-50 p-2 rounded border border-yellow-100">
                <label className="text-xs font-bold text-[#37424A] whitespace-nowrap">Traktor Start (m):</label>
                <input type="number" className="w-full text-xs p-1 border rounded" value={tractorDepth} onChange={(e) => { setTractorDepth(parseFloat(e.target.value)); onUpdate({ ...runData.simulations, tractorDepth: parseFloat(e.target.value) }); }} />
              </div>
            )}
          </div>
          <FileUploader label="3. POOH (Opsjon)" color="border-[#00A99D]" hasData={!!files.pooh} onUpload={(f) => handleFileUpload('pooh', f)} />
        </div>

        <div className="flex-grow bg-white border rounded-lg p-4 relative">
          {!files.rih && <div className="absolute inset-0 flex items-center justify-center text-gray-400 z-10 bg-white/50">Last opp RIH fil for å se grafen</div>}
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={['auto', 'auto']} label={{ value: 'Tension (kg)', position: 'insideBottom', offset: -10 }} style={{ fontSize: '10px' }} />
              <YAxis type="number" dataKey="md" reversed={true} label={{ value: 'Dybde (m)', angle: -90, position: 'insideLeft' }} style={{ fontSize: '10px' }} />
              <Tooltip contentStyle={{ fontSize: '12px' }} labelFormatter={(label) => `MD: ${label} m`} />
              <Legend verticalAlign="top" height={36} />

              {/* RIH Standard Line */}
              <Line name="RIH (Standard)" dataKey="rih_standard" stroke="#37424A" strokeWidth={2} dot={false} type="monotone" />

              {/* RIH Tractor Line - connects from where standard left off */}
              <Line name="RIH (Traktor)" dataKey="rih_tractor" stroke="#FFC82E" strokeWidth={3} dot={false} type="monotone" strokeDasharray="5 5" />

              {/* POOH Line */}
              <Line name="POOH" dataKey="pooh" stroke="#00A99D" strokeWidth={2} dot={false} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function FileUploader({ label, color, hasData, onUpload }) {
  return (
    <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${hasData ? 'bg-gray-50 border-solid ' + color : 'hover:bg-gray-50 ' + color}`}>
      <div className="text-xs font-bold text-gray-500 uppercase mb-2">{label}</div>
      {hasData ? (
        <div className="flex flex-col items-center">
          <Check size={24} className="text-green-500 mb-1" />
          <span className="text-xs font-bold text-gray-700">Fil lastet opp</span>
          <button onClick={() => onUpload(null)} className="text-[10px] text-red-500 underline mt-1">Fjern fil</button>
        </div>
      ) : (
        <div className="relative">
          <input type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" accept=".csv,.txt" onChange={(e) => onUpload(e.target.files[0])} />
          <div className="flex flex-col items-center pointer-events-none">
            <Upload size={20} className="text-gray-400 mb-1" />
            <span className="text-[10px] text-gray-400">Klikk for å laste opp</span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- FEATURE: RUN CONFIGURATION (MODIFIED TO BE EMBEDDABLE) ---
function RunConfiguration({ well, onCancel, onSave, initialRun, embedded }) {
  const [activeStep, setActiveStep] = useState(null);
  const [confirmedSteps, setConfirmedSteps] = useState({});
  const [runData, setRunData] = useState(initialRun);

  // Sync internal state if initialRun changes (e.g. from parent tab switch)
  useEffect(() => { setRunData(initialRun); }, [initialRun]);

  const maxDepth = useMemo(() => Math.max(...well.survey.map(p => p.md), 0), [well]);
  const trajectory = useMemo(() => calculateTrajectory(well.survey), [well.survey]);
  const surveyMD = useMemo(() => well.survey.map(p => p.md), [well]);
  const surveyTVD = useMemo(() => trajectory.map(p => p.tvd), [trajectory]);
  const maxTVD = Math.max(...surveyTVD);

  const getTVD = (md) => interpolate(md, surveyMD, surveyTVD);
  const getMD = (tvd) => interpolate(tvd, surveyTVD, surveyMD);

  const isComplete = {
    1: confirmedSteps[1] || (runData.general?.goal && runData.general?.targetDepth), // Basic check for edit mode
    2: confirmedSteps[2] || runData.pce?.type,
    3: confirmedSteps[3] || runData.fluids?.whp,
    4: confirmedSteps[4] || runData.temps?.length > 0,
    5: confirmedSteps[5] || true, // Defaults exist
    6: confirmedSteps[6] || true
  };

  const handleStepComplete = (stepId) => {
    setConfirmedSteps(prev => ({ ...prev, [stepId]: true }));
    setActiveStep(null);
    // Auto save on step completion
    onSave(well.id, runData);
  };

  const steps = [
    { id: 1, title: 'Generell informasjon', icon: <Info size={20} /> },
    { id: 2, title: 'Pressure Control Equipment (PCE)', icon: <Settings size={20} /> },
    { id: 3, title: 'Brønnvæske & Trykk', icon: <Droplet size={20} /> },
    { id: 4, title: 'Temperaturprofil', icon: <Thermometer size={20} /> },
    { id: 5, title: 'Rod Egenskaper', icon: <Activity size={20} /> },
    { id: 6, title: 'BHA (Bottom Hole Assembly)', icon: <Anchor size={20} /> }
  ];

  const renderStep = () => {
    switch (activeStep) {
      case 1: return <StepGeneral data={runData.general} setData={(d) => setRunData({ ...runData, general: d })} maxDepth={maxDepth} onComplete={() => handleStepComplete(1)} />;
      case 2: return <StepPCE data={runData.pce} setData={(d) => setRunData({ ...runData, pce: d })} onComplete={() => handleStepComplete(2)} />;
      case 3: return <StepFluids data={runData.fluids} setData={(d) => setRunData({ ...runData, fluids: d })} maxTVD={maxTVD} maxMD={maxDepth} getMD={getMD} getTVD={getTVD} onComplete={() => handleStepComplete(3)} />;
      case 4: return <StepTemperature data={runData.temps} setData={(d) => setRunData({ ...runData, temps: d })} getMD={getMD} getTVD={getTVD} maxDepth={maxDepth} onComplete={() => handleStepComplete(4)} />;
      case 5: return <StepRod data={runData.rod} setData={(d) => setRunData({ ...runData, rod: d })} onComplete={() => handleStepComplete(5)} />;
      case 6: return <StepBHA data={runData.bha} setData={(d) => setRunData({ ...runData, bha: d })} onComplete={() => handleStepComplete(6)} />;
      default: return null;
    }
  };

  if (activeStep === null) {
    return (
      <div className="max-w-4xl mx-auto py-8 h-full flex flex-col">
        {!embedded && (
          <div className="flex items-center gap-4 mb-8 shrink-0">
            <button onClick={onCancel} className="p-2 hover:bg-white rounded-full text-gray-500"><ArrowRight className="rotate-180" /></button>
            <div><h2 className="text-2xl font-bold text-[#37424A]">{initialRun ? 'Rediger Run' : 'Nytt Run Konfigurasjon'}</h2><p className="text-sm text-gray-500">Fyll ut alle stegene nedenfor for å klargjøre simuleringen.</p></div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 overflow-y-auto flex-grow pr-2">
          {steps.map(step => (
            <div key={step.id} onClick={() => setActiveStep(step.id)} className={`bg-white p-6 rounded-lg shadow-sm border flex items-center justify-between cursor-pointer transition-colors group ${isComplete[step.id] ? 'border-green-200 bg-green-50' : 'border-gray-200 hover:border-[#FFC82E]'}`}>
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isComplete[step.id] ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>{isComplete[step.id] ? <Check size={24} /> : step.icon}</div>
                <div><h3 className="font-bold text-[#37424A] group-hover:text-[#FFC82E] transition-colors">{step.id}. {step.title}</h3><p className="text-xs text-gray-400">{isComplete[step.id] ? 'Fullført' : 'Må fylles ut'}</p></div>
              </div>
              <ChevronRight className="text-gray-300 group-hover:text-[#37424A]" />
            </div>
          ))}
        </div>
        {!embedded && <div className="mt-8 flex justify-end shrink-0"><button disabled={Object.values(isComplete).some(x => !x)} onClick={() => onSave(well.id, runData)} className={`px-8 py-3 rounded font-bold text-white ${Object.values(isComplete).some(x => !x) ? 'bg-gray-300 cursor-not-allowed' : 'bg-[#37424A] hover:bg-slate-700'}`}>{initialRun ? 'Lagre Endringer' : 'Opprett Run'}</button></div>}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-slate-50">
        <button onClick={() => setActiveStep(null)} className="text-sm font-bold text-gray-500 hover:text-[#37424A] flex items-center gap-2"><ArrowRight className="rotate-180" size={16} /> Tilbake til oversikt</button>
        <h3 className="font-bold text-[#37424A]">{steps.find(s => s.id === activeStep)?.title}</h3><div className="w-20"></div>
      </div>
      <div className="flex-grow overflow-hidden p-6">{renderStep()}</div>
    </div>
  );
}

function StepGeneral({ data, setData, maxDepth, onComplete }) {
  const isDepthInvalid = parseFloat(data.targetDepth) > maxDepth;
  return (
    <div className="max-w-lg mx-auto space-y-6 pt-10 h-full flex flex-col">
      <div className="flex-grow space-y-6">
        <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mål for operasjonen</label><textarea className="w-full border border-gray-300 p-3 rounded h-32 text-sm focus:border-[#FFC82E] outline-none" placeholder="Beskriv formålet..." value={data.goal} onChange={e => setData({ ...data, goal: e.target.value })} /></div>
        <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Måldybde (MD)</label><div className="flex items-center gap-2"><input type="number" className={`w-full border p-3 rounded text-sm focus:border-[#FFC82E] outline-none ${isDepthInvalid ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} value={data.targetDepth} onChange={e => setData({ ...data, targetDepth: e.target.value })} /><span className="text-sm text-gray-500">meter</span></div>{isDepthInvalid && <p className="text-xs text-red-500 mt-1 font-bold">Feil: Dybde overstiger brønnens totale dybde ({maxDepth.toFixed(0)} m).</p>}</div>
      </div>
      <button onClick={onComplete} disabled={!data.targetDepth || !data.goal || isDepthInvalid} className={`w-full py-3 rounded font-bold mt-auto ${data.targetDepth && data.goal && !isDepthInvalid ? 'bg-[#37424A] text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>Lagre & Gå til Oversikt</button>
    </div>
  );
}

function StepPCE({ data, setData, onComplete }) {
  const [confirmed, setConfirmed] = useState(false);
  const handleSelect = (type, force, friction) => { setData({ type, force, friction }); setConfirmed(false); };
  return (
    <div className="max-w-lg mx-auto space-y-6 pt-10 h-full flex flex-col">
      <div className="flex-grow space-y-6">
        <div><label className="block text-xs font-bold text-gray-500 uppercase mb-2">Type Utstyr</label><div className="flex gap-4"><button onClick={() => handleSelect('SDS', 100, 0.5)} className={`flex-1 py-3 rounded border font-bold text-sm transition-all ${data.type === 'SDS' ? 'bg-[#37424A] text-white border-[#37424A]' : 'bg-white text-gray-600 border-gray-200'}`}>SDS</button><button onClick={() => handleSelect('GIH', 100, 0.2)} className={`flex-1 py-3 rounded border font-bold text-sm transition-all ${data.type === 'GIH' ? 'bg-[#37424A] text-white border-[#37424A]' : 'bg-white text-gray-600 border-gray-200'}`}>GIH</button></div></div>
        {data.type && (<div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-4 duration-300"><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Kontaktkraft (kg)</label><input type="number" className="w-full border p-2 rounded" value={data.force} onChange={e => setData({ ...data, force: parseFloat(e.target.value) })} /></div><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Friksjonsfaktor</label><input type="number" step="0.1" className="w-full border p-2 rounded" value={data.friction} onChange={e => setData({ ...data, friction: parseFloat(e.target.value) })} /></div></div>)}
      </div>
      <button onClick={() => { setConfirmed(true); onComplete() }} disabled={!data.type} className={`w-full py-3 rounded font-bold mt-auto ${data.type ? 'bg-[#37424A] text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>Lagre & Gå til Oversikt</button>
    </div>
  );
}

function StepFluids({ data, setData, maxTVD, maxMD, getTVD, onComplete }) {
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcInputs, setCalcInputs] = useState({ dhgp: 0, gaugeDepth: 0, fluidTop: 'Gass', fluidBot: 'Olje' });
  const [calcResult, setCalcResult] = useState(null);

  const pressureData = useMemo(() => {
    const points = [];
    const depthStep = maxMD / 50;
    const whp = parseFloat(data.whp || 0);
    let currentTVD = 0;
    const fluidSections = data.list.map(f => {
      const height = (parseFloat(f.percent || 0) / 100) * maxTVD;
      const start = currentTVD;
      const end = currentTVD + height;
      currentTVD += height;
      return { ...f, startTVD: start, endTVD: end };
    });
    for (let md = 0; md <= maxMD; md += depthStep) {
      const tvd = getTVD(md);
      let p = whp;
      for (const f of fluidSections) {
        if (tvd > f.endTVD) p += (f.endTVD - f.startTVD) * f.sg * 0.0981;
        else if (tvd > f.startTVD) p += (tvd - f.startTVD) * f.sg * 0.0981;
      }
      points.push({ md: parseFloat(md.toFixed(0)), pressure: parseFloat(p.toFixed(1)) });
    }
    return points;
  }, [data, maxMD, maxTVD, getTVD]);

  const updatePercent = (idx, val) => { const newList = [...data.list]; newList[idx].percent = isNaN(parseFloat(val)) ? 0 : parseFloat(val); setData({ ...data, list: newList }); };
  const updateTVDInput = (idx, val) => { const tvdVal = parseFloat(val); if (isNaN(tvdVal)) return; const pct = (tvdVal / maxTVD) * 100; const newList = [...data.list]; newList[idx].percent = parseFloat(pct.toFixed(2)); setData({ ...data, list: newList }); };

  const calculateInterface = () => {
    const g_factor = 0.0981;
    const f1 = data.list.find(f => f.type === calcInputs.fluidTop);
    const f2 = data.list.find(f => f.type === calcInputs.fluidBot);
    if (!f1 || !f2) return alert("Velg to væsker fra listen.");
    const rho1 = f1.sg; const rho2 = f2.sg;
    const P_g = parseFloat(calcInputs.dhgp); const P_whp = parseFloat(data.whp || 0); const D_g = parseFloat(calcInputs.gaugeDepth);
    if (rho1 === rho2) { alert("Væskene må ha ulik tetthet."); return; }
    const D_int = (P_g - P_whp - (rho2 * g_factor * D_g)) / (g_factor * (rho1 - rho2));
    if (D_int < 0 || D_int > D_g) { setCalcResult({ error: `Ulogisk dyp: ${D_int.toFixed(1)}m` }); }
    else {
      setCalcResult({ depth: D_int.toFixed(1) });
      const pctTop = (D_int / maxTVD) * 100;
      const idx1 = data.list.findIndex(f => f.type === calcInputs.fluidTop);
      const idx2 = data.list.findIndex(f => f.type === calcInputs.fluidBot);
      const newList = [...data.list];
      newList.forEach(f => f.percent = 0);
      newList[idx1].percent = parseFloat(pctTop.toFixed(2));
      newList[idx2].percent = parseFloat((100 - pctTop).toFixed(2));
      setData({ ...data, list: newList });
    }
  };

  const totalPercent = data.list.reduce((sum, f) => sum + (f.percent || 0), 0);
  const isInvalid = Math.abs(totalPercent - 100) > 0.5;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
      <div className="flex flex-col h-full overflow-y-auto pr-2">
        <h4 className="font-bold text-[#37424A] mb-4">Konfigurasjon</h4>
        <div className="mb-6"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">WHP (Brønnhodetrykk) [bar]</label><input type="number" className="w-full border p-2 rounded font-bold" value={data.whp} onChange={e => setData({ ...data, whp: e.target.value })} /></div>
        <div className="space-y-4 mb-6">
          {data.list.map((f, i) => (
            <div key={i} className="bg-gray-50 p-3 rounded border border-gray-200">
              <div className="flex justify-between mb-2 font-bold text-sm"><span>{f.type}</span><span className="text-gray-400">{((f.percent || 0) / 100 * maxTVD).toFixed(0)} m (TVD høyde)</span></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-[10px] text-gray-500 uppercase block">Tetthet (SG)</label><input type="number" className="w-full border rounded p-1 text-sm" value={f.sg} onChange={e => { const l = [...data.list]; l[i].sg = parseFloat(e.target.value); setData({ ...data, list: l }); }} /></div>
                <div><label className="text-[10px] text-gray-500 uppercase block">Volumandel (%)</label><input type="number" className="w-full border rounded p-1 text-sm" value={f.percent} onChange={e => updatePercent(i, e.target.value)} /></div>
                <div><label className="text-[10px] text-gray-500 uppercase block">TVD Høyde (m)</label><input type="number" className="w-full border rounded p-1 text-sm bg-blue-50" value={(((f.percent || 0) / 100) * maxTVD).toFixed(1)} onChange={e => updateTVDInput(i, e.target.value)} /></div>
              </div>
            </div>
          ))}
          {isInvalid && (<div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded text-sm border border-red-200"><AlertTriangle size={16} /> Totalt volum er {totalPercent.toFixed(1)}% (Må være 100%)</div>)}
        </div>
        <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
          <button onClick={() => setCalcOpen(!calcOpen)} className="w-full flex justify-between items-center p-3 bg-gray-100 hover:bg-gray-200 text-xs font-bold text-[#37424A]"><span className="flex items-center gap-2"><Calculator size={14} /> Interface Kalkulator (Væskespeil)</span>{calcOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
          {calcOpen && (
            <div className="p-4 bg-white space-y-3 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-2">Beregner væskeskillet basert på trykkforskjell.</p>
              <div className="grid grid-cols-2 gap-2"><div><label className="text-[10px] text-gray-500 block">Bunntrykk (DHGP) [bar]</label><input type="number" className="border w-full p-1 rounded" value={calcInputs.dhgp} onChange={e => setCalcInputs({ ...calcInputs, dhgp: e.target.value })} /></div><div><label className="text-[10px] text-gray-500 block">Gauge Dybde (TVD m)</label><input type="number" className="border w-full p-1 rounded" value={calcInputs.gaugeDepth} onChange={e => setCalcInputs({ ...calcInputs, gaugeDepth: e.target.value })} /></div></div>
              <div className="flex gap-2 text-xs items-center"><select className="border p-1 rounded" value={calcInputs.fluidTop} onChange={e => setCalcInputs({ ...calcInputs, fluidTop: e.target.value })}>{data.list.map(f => <option key={f.type} value={f.type}>{f.type}</option>)}</select><span>over</span><select className="border p-1 rounded" value={calcInputs.fluidBot} onChange={e => setCalcInputs({ ...calcInputs, fluidBot: e.target.value })}>{data.list.map(f => <option key={f.type} value={f.type}>{f.type}</option>)}</select></div>
              <button onClick={calculateInterface} className="w-full bg-[#00A99D] text-white text-xs font-bold py-2 rounded mt-2 hover:bg-teal-600">Beregn & Oppdater</button>
              {calcResult && <div className={`mt-2 text-center text-xs font-bold ${calcResult.error ? 'text-red-500' : 'text-green-600'}`}>{calcResult.error || `Grensesnitt funnet på ${calcResult.depth} m TVD`}</div>}
            </div>
          )}
        </div>
        <button onClick={onComplete} disabled={isInvalid} className={`w-full py-3 rounded font-bold mt-auto ${!isInvalid ? 'bg-[#37424A] text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>Lagre & Gå til Oversikt</button>
      </div>
      <div className="bg-white border rounded-lg p-4 flex flex-col">
        <h4 className="font-bold text-[#37424A] text-xs mb-2">Hydrostatisk Trykkprofil</h4>
        <div className="flex-grow"><ResponsiveContainer width="100%" height="100%"><LineChart data={pressureData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" /><XAxis type="number" dataKey="md" label={{ value: 'MD (m)', position: 'insideBottom', offset: -5 }} style={{ fontSize: '10px' }} /><YAxis type="number" dataKey="pressure" label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }} style={{ fontSize: '10px' }} /><Tooltip contentStyle={{ fontSize: '12px' }} labelFormatter={(label) => `MD: ${label} m`} /><Line dataKey="pressure" stroke="#00A99D" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
      </div>
    </div>
  );
}

// --- STEP 4: TEMPERATURE (UPDATED WITH PLOT) ---
function StepTemperature({ data, setData, getTVD, getMD, maxDepth, onComplete }) {
  const [units, setUnits] = useState({ depth: 'm', temp: 'C' });
  const updateRow = (i, field, val) => { const newData = [...data]; const numVal = parseFloat(val); newData[i][field] = numVal; if (field === 'md') newData[i].tvd = parseFloat(getTVD(numVal).toFixed(1)); else if (field === 'tvd') newData[i].md = parseFloat(getMD(numVal).toFixed(1)); newData.sort((a, b) => a.md - b.md); setData(newData); };
  const addRow = () => setData([...data, { md: 0, tvd: 0, temp: 0 }].sort((a, b) => a.md - b.md));
  const removeRow = (i) => setData(data.filter((_, idx) => idx !== i));
  const hasErrors = data.some(row => row.md > maxDepth);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
      <div className="flex flex-col h-full">
        <h4 className="font-bold text-[#37424A] mb-4">Profil Data</h4>
        <div className="bg-white border rounded-lg overflow-hidden flex-grow mb-4">
          <div className="flex bg-gray-50 text-xs font-bold text-gray-500 border-b p-3"><div className="flex-1">MD ({units.depth})</div><div className="flex-1">TVD ({units.depth})</div><div className="flex-1">Temp ({units.temp})</div><div className="w-8"></div></div>
          {data.map((row, i) => (<div key={i} className="flex border-b last:border-0 p-2 items-center gap-2"><input type="number" className={`flex-1 border rounded px-2 py-1 text-sm ${row.md > maxDepth ? 'border-red-500 bg-red-50' : ''}`} value={row.md} onChange={e => updateRow(i, 'md', e.target.value)} /><input type="number" className="flex-1 border rounded px-2 py-1 text-sm bg-gray-50" value={row.tvd} readOnly /><input type="number" className="flex-1 border rounded px-2 py-1 text-sm" value={row.temp} onChange={e => updateRow(i, 'temp', e.target.value)} /><button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button></div>))}
        </div>
        {hasErrors && <div className="text-xs text-red-500 font-bold mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Dybde kan ikke være større enn brønnens maks dybde ({maxDepth.toFixed(0)}m).</div>}
        <button onClick={addRow} className="text-[#00A99D] font-bold text-sm flex items-center gap-1 hover:underline mt-2 mb-4"><Plus size={16} /> Legg til punkt</button>
        <button onClick={onComplete} disabled={hasErrors} className={`w-full py-3 rounded font-bold mt-auto ${hasErrors ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-[#37424A] text-white'}`}>Lagre & Gå til Oversikt</button>
      </div>
      <div className="bg-white border rounded-lg p-4 flex flex-col">
        <h4 className="font-bold text-[#37424A] text-xs mb-2">Temperatur vs MD</h4>
        <div className="flex-grow"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" /><XAxis type="number" dataKey="md" domain={[0, maxDepth]} label={{ value: 'MD (m)', position: 'insideBottom', offset: -5 }} style={{ fontSize: '10px' }} /><YAxis type="number" dataKey="temp" label={{ value: 'Temp (C)', angle: -90, position: 'insideLeft' }} style={{ fontSize: '10px' }} /><Tooltip contentStyle={{ fontSize: '12px' }} /><Line dataKey="temp" stroke="#FFC82E" strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div>
      </div>
    </div>
  );
}

// --- STEP 5: ROD (UPDATED WITH INDIVIDUAL TOGGLES) ---
function StepRod({ data, setData, onComplete }) {
  const UnitInput = ({ label, field, val, unitStateKey, baseUnit, altUnit, conversion }) => {
    const currentUnit = data.units?.[field] || baseUnit;
    const displayVal = currentUnit === baseUnit ? val : (val * conversion).toFixed(3);
    const toggle = () => { const newUnits = { ...(data.units || {}), [field]: currentUnit === baseUnit ? altUnit : baseUnit }; setData({ ...data, units: newUnits }); };
    const handleChange = (e) => { let newVal = parseFloat(e.target.value); if (currentUnit === altUnit) newVal = newVal / conversion; setData({ ...data, [field]: newVal }); };
    return (
      <div>
        <div className="flex justify-between mb-1"><label className="text-xs font-bold text-gray-500 uppercase">{label}</label><button onClick={toggle} className="text-[10px] bg-gray-200 px-2 rounded hover:bg-gray-300 font-mono text-gray-600 transition-colors">{currentUnit}</button></div>
        <input type="number" step="0.001" className="w-full border p-2 rounded text-sm" value={displayVal} onChange={handleChange} />
      </div>
    );
  };
  return (
    <div className="max-w-2xl mx-auto pt-6 h-full flex flex-col">
      <div className="flex-grow">
        <h3 className="font-bold text-[#37424A] text-lg border-b pb-4 mb-6">5. Rod Egenskaper</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-6">
          <UnitInput label="Diameter" field="diameter" val={data.diameter} baseUnit="cm" altUnit="in" conversion={1 / 2.54} />
          <UnitInput label="Lineær Vekt" field="weight" val={data.weight} baseUnit="kg/m" altUnit="lb/ft" conversion={0.671969} />
          <UnitInput label="Youngs Modulus" field="youngs" val={data.youngs} baseUnit="GPa" altUnit="psi" conversion={145038} />
          <div className="col-span-2 border-t pt-4 mt-2">
            <h4 className="text-sm font-bold text-gray-700 mb-4">Friksjonsfaktorer (Uten enhet)</h4>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="block text-xs font-bold text-gray-500 mb-1">Væske</label><input type="number" step="0.01" className="w-full border p-2 rounded" value={data.fluidFric} onChange={e => setData({ ...data, fluidFric: parseFloat(e.target.value) })} /></div>
              <div><label className="block text-xs font-bold text-gray-500 mb-1">RIH</label><input type="number" step="0.1" className="w-full border p-2 rounded" value={data.rihFric} onChange={e => setData({ ...data, rihFric: parseFloat(e.target.value) })} /></div>
              <div><label className="block text-xs font-bold text-gray-500 mb-1">POOH</label><input type="number" step="0.1" className="w-full border p-2 rounded" value={data.poohFric} onChange={e => setData({ ...data, poohFric: parseFloat(e.target.value) })} /></div>
            </div>
          </div>
        </div>
      </div>
      <button onClick={onComplete} className="w-full bg-[#37424A] text-white py-3 rounded font-bold mt-auto">Lagre & Gå til Oversikt</button>
    </div>
  );
}

// --- STEP 6: BHA CONFIGURATION ---
function StepBHA({ data, setData, onComplete }) {
  const [units, setUnits] = useState({ od: 'cm', length: 'm', weight: 'kg' });
  const toggleUnit = (key) => { let newUnit = ''; if (key === 'od') newUnit = units.od === 'cm' ? 'in' : 'cm'; if (key === 'length') newUnit = units.length === 'm' ? 'ft' : 'm'; if (key === 'weight') newUnit = units.weight === 'kg' ? 'lbs' : 'kg'; setUnits({ ...units, [key]: newUnit }); };
  const addTool = () => { const newTool = { id: Math.random().toString(), name: '', od: 0, length: 0, weight: 0, expanded: false, youngs: 2000000, fricRIH: 1.0, fricPOOH: 1.0, fricFluid: 0.4, isKnuckle: false, isTractor: false, tractorForce: 0, isCentralizer: false, centForce: 0, centMaxOD: 0 }; setData({ ...data, tools: [...(data.tools || []), newTool] }); };
  const updateTool = (index, field, val) => { const tools = [...(data.tools || [])]; tools[index][field] = val; setData({ ...data, tools }); };
  const removeTool = (index) => { const tools = [...(data.tools || [])]; tools.splice(index, 1); setData({ ...data, tools }); };
  const duplicateTool = (index) => { const tools = [...(data.tools || [])]; const tool = { ...tools[index], id: Math.random().toString() }; tools.splice(index + 1, 0, tool); setData({ ...data, tools }); };
  const moveTool = (index, direction) => { if ((direction === -1 && index === 0) || (direction === 1 && index === (data.tools || []).length - 1)) return; const tools = [...(data.tools || [])]; const temp = tools[index]; tools[index] = tools[index + direction]; tools[index + direction] = temp; setData({ ...data, tools }); };
  const toggleExpand = (index) => { const tools = [...(data.tools || [])]; tools[index].expanded = !tools[index].expanded; setData({ ...data, tools }); };
  const tools = data.tools || [];
  const convert = (val, type) => { if (type === 'od') return units.od === 'cm' ? val : val / 2.54; if (type === 'length') return units.length === 'm' ? val : val * 3.28084; if (type === 'weight') return units.weight === 'kg' ? val : val * 2.20462; return val; };
  const handleInputChange = (index, field, val) => { let numVal = parseFloat(val); if (field === 'od' && units.od === 'in') numVal = numVal * 2.54; if (field === 'length' && units.length === 'ft') numVal = numVal / 3.28084; if (field === 'weight' && units.weight === 'lbs') numVal = numVal / 2.20462; updateTool(index, field, isNaN(numVal) ? 0 : numVal); };
  const totalLength = tools.reduce((s, t) => s + parseFloat(t.length || 0), 0);
  const totalWeight = tools.reduce((s, t) => s + parseFloat(t.weight || 0), 0);

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-end mb-4 shrink-0">
        <div><h3 className="font-bold text-[#37424A] text-xl">BHA Konfigurasjon</h3><p className="text-xs text-gray-500">Bygg verktøystrengen komponent for komponent.</p></div>
        <div className="flex gap-2"><input className="border p-2 rounded text-sm w-64" placeholder="Navn på BHA" value={data.name || ''} onChange={e => setData({ ...data, name: e.target.value })} /></div>
      </div>
      <div className="flex-grow overflow-hidden border rounded-lg flex flex-col">
        <div className="flex bg-gray-100 text-xs font-bold text-gray-600 border-b p-3">
          <div className="flex-[2]">Verktøy Navn</div><div className="flex-1 cursor-pointer hover:text-[#00A99D]" onClick={() => toggleUnit('od')}>OD ({units.od})</div><div className="flex-1 cursor-pointer hover:text-[#00A99D]" onClick={() => toggleUnit('length')}>Lengde ({units.length})</div><div className="flex-1 cursor-pointer hover:text-[#00A99D]" onClick={() => toggleUnit('weight')}>Vekt ({units.weight})</div><div className="w-40 text-center">Handlinger</div>
        </div>
        <div className="overflow-y-auto flex-grow bg-white">
          {tools.length === 0 && <div className="p-8 text-center text-gray-400 text-sm">Ingen verktøy lagt til.</div>}
          {tools.map((tool, i) => (
            <div key={tool.id} className="border-b border-gray-100">
              <div className="flex p-2 items-center gap-2">
                <div className="flex-[2]"><input className="w-full border rounded p-1 text-sm" placeholder="Søk verktøy..." value={tool.name} onChange={e => updateTool(i, 'name', e.target.value)} /></div>
                <div className="flex-1"><input type="number" step="any" className="w-full border rounded p-1 text-sm" value={convert(tool.od, 'od').toFixed(2)} onChange={e => handleInputChange(i, 'od', e.target.value)} /></div>
                <div className="flex-1"><input type="number" step="any" className="w-full border rounded p-1 text-sm" value={convert(tool.length, 'length').toFixed(2)} onChange={e => handleInputChange(i, 'length', e.target.value)} /></div>
                <div className="flex-1"><input type="number" step="any" className="w-full border rounded p-1 text-sm" value={convert(tool.weight, 'weight').toFixed(1)} onChange={e => handleInputChange(i, 'weight', e.target.value)} /></div>
                <div className="w-40 flex justify-center gap-1">
                  <button onClick={() => moveTool(i, -1)} className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-600" disabled={i === 0}><ArrowUp size={14} /></button>
                  <button onClick={() => moveTool(i, 1)} className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-600" disabled={i === tools.length - 1}><ArrowDown size={14} /></button>
                  <button onClick={() => toggleExpand(i)} className={`p-1 rounded ${tool.expanded ? 'bg-gray-200' : 'hover:bg-gray-100'}`}><Settings size={14} className="text-gray-500" /></button>
                  <button onClick={() => duplicateTool(i)} className="p-1 rounded hover:bg-gray-100" title="Dupliser"><Copy size={14} className="text-gray-500" /></button>
                  <button onClick={() => removeTool(i)} className="p-1 rounded hover:bg-red-50" title="Slett"><Trash2 size={14} className="text-red-400" /></button>
                </div>
              </div>
              {tool.expanded && (
                <div className="bg-slate-50 p-4 border-t border-gray-100 text-xs grid grid-cols-2 gap-4 shadow-inner">
                  <div className="space-y-2">
                    <h4 className="font-bold text-gray-500 mb-2">Fysikk Egenskaper</h4>
                    <div className="flex justify-between items-center"><span>Young's Modulus (Bar):</span> <input type="number" className="border rounded w-24 p-1" value={tool.youngs} onChange={e => updateTool(i, 'youngs', parseFloat(e.target.value))} /></div>
                    <div className="flex justify-between items-center"><span>RIH Friksjon:</span> <input type="number" step="0.1" className="border rounded w-24 p-1" value={tool.fricRIH} onChange={e => updateTool(i, 'fricRIH', parseFloat(e.target.value))} /></div>
                    <div className="flex justify-between items-center"><span>POOH Friksjon:</span> <input type="number" step="0.1" className="border rounded w-24 p-1" value={tool.fricPOOH} onChange={e => updateTool(i, 'fricPOOH', parseFloat(e.target.value))} /></div>
                    <div className="flex justify-between items-center"><span>Væske Friksjon:</span> <input type="number" step="0.1" className="border rounded w-24 p-1" value={tool.fricFluid} onChange={e => updateTool(i, 'fricFluid', parseFloat(e.target.value))} /></div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-bold text-gray-500 mb-2">Funksjonalitet</h4>
                    <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={tool.isKnuckle} onChange={e => updateTool(i, 'isKnuckle', e.target.checked)} /> Knuckle Joint</label>
                    <div className="flex items-center gap-2"><label className="flex items-center gap-2 cursor-pointer w-24"><input type="checkbox" checked={tool.isTractor} onChange={e => updateTool(i, 'isTractor', e.target.checked)} /> Traktor</label>{tool.isTractor && <input type="number" className="border rounded w-24 p-1" placeholder="Kraft (kg)" value={tool.tractorForce} onChange={e => updateTool(i, 'tractorForce', parseFloat(e.target.value))} />}</div>
                    <div className="flex items-center gap-2"><label className="flex items-center gap-2 cursor-pointer w-24"><input type="checkbox" checked={tool.isCentralizer} onChange={e => updateTool(i, 'isCentralizer', e.target.checked)} /> Sentralizer</label>{tool.isCentralizer && (<div className="flex gap-2"><input type="number" className="border rounded w-20 p-1" placeholder="Kraft (kg)" value={tool.centForce} onChange={e => updateTool(i, 'centForce', parseFloat(e.target.value))} /><input type="number" className="border rounded w-20 p-1" placeholder="Maks OD" value={tool.centMaxOD} onChange={e => updateTool(i, 'centMaxOD', parseFloat(e.target.value))} /></div>)}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="bg-[#37424A] text-white p-3 flex justify-between items-center text-xs font-bold">
          <button onClick={addTool} className="bg-[#FFC82E] text-[#37424A] px-4 py-1.5 rounded hover:bg-[#E5B020] flex items-center gap-2"><Plus size={14} /> Legg til Verktøy</button>
          <div className="flex gap-6">
            <span>Antall: {tools.length}</span>
            <span>Total Lengde: {convert(totalLength, 'length').toFixed(2)} {units.length}</span>
            <span>Total Vekt: {convert(totalWeight, 'weight').toFixed(2)} {units.weight}</span>
          </div>
        </div>
      </div>
      <button onClick={onComplete} className={`w-full py-3 rounded font-bold mt-4 bg-[#37424A] text-white`}>Lagre & Gå til Oversikt</button>
    </div>
  );
}

// --- COMPONENT: DASHBOARD ---
function Dashboard({ onNewWell, wells, onViewWell, onDeleteWell, onEditWell }) {
  const [searchTerm, setSearchTerm] = useState('');
  const filteredWells = wells.filter(w => w.name.toLowerCase().includes(searchTerm.toLowerCase()) || w.field.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div><h2 className="text-2xl font-bold text-[#37424A]">Dine Brønner</h2><p className="text-gray-500">Oversikt over alle aktive og planlagte brønner.</p></div>
        <button onClick={onNewWell} className="bg-[#FFC82E] text-[#37424A] px-6 py-3 rounded font-bold shadow-sm hover:bg-[#E5B020] transition-colors flex items-center gap-2"><Plus size={20} /> Ny Brønn</button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex items-center gap-4">
        <Search className="text-gray-400" />
        <input type="text" placeholder="Søk etter brønn eller felt..." className="flex-grow outline-none text-gray-600" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredWells.map(well => (
          <div key={well.id} className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow group relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-[#37424A] group-hover:bg-[#FFC82E] transition-colors"></div>
            <div className="p-6 cursor-pointer" onClick={() => onViewWell(well)}>
              <div className="flex justify-between items-start mb-4">
                <div><h3 className="font-bold text-lg text-[#37424A]">{well.name}</h3><p className="text-sm text-gray-500">{well.field}</p></div>
                <div className="bg-gray-100 p-2 rounded-full"><Activity size={20} className="text-[#00A99D]" /></div>
              </div>
              <div className="space-y-2 text-sm text-gray-600 mb-4">
                <div className="flex items-center gap-2"><MapPin size={16} className="text-gray-400" /> <span>{well.country}</span></div>
                <div className="flex items-center gap-2"><Database size={16} className="text-gray-400" /> <span>{well.survey?.length || 0} målepunkter</span></div>
                <div className="flex items-center gap-2"><Layers size={16} className="text-gray-400" /> <span>{well.architecture?.length || 0} casing seksjoner</span></div>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400 pt-4 border-t border-gray-100">
                <span>Sist endret: {new Date().toLocaleDateString()}</span>
                <span className="font-bold text-[#37424A] group-hover:text-[#FFC82E] transition-colors flex items-center gap-1">Åpne <ArrowRight size={12} /></span>
              </div>
            </div>
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
              <button onClick={(e) => { e.stopPropagation(); onEditWell(well); }} className="p-1.5 bg-gray-100 hover:bg-white rounded text-gray-500 hover:text-[#37424A] shadow-sm"><Edit2 size={14} /></button>
              <button onClick={(e) => { e.stopPropagation(); onDeleteWell(well.id); }} className="p-1.5 bg-red-50 hover:bg-red-100 rounded text-red-400 hover:text-red-600 shadow-sm"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {filteredWells.length === 0 && (
          <div className="col-span-full py-12 text-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <Search size={48} className="mx-auto mb-4 opacity-20" />
            <p>Ingen brønner funnet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- COMPONENT: STEP SURVEY IMPORT (WITH DRAG-DROP & EXCEL) ---
function StepSurveyImport({ onBack, onNext, existingData }) {
  const [rawText, setRawText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [config, setConfig] = useState({ startLine: 2, delimiter: 'auto', colMD: 1, colInc: 2, colAzi: 3, unitMultiplier: 1, thousandSep: 'none' });
  const parsedData = useMemo(() => parseSurveyData(rawText, config), [rawText, config]);
  const trajectory3D = useMemo(() => calculateTrajectory(parsedData), [parsedData]);
  const fileInputRef = useRef(null);

  // Pre-fill text area if existing data is present
  useEffect(() => {
    if (existingData && existingData.length > 0 && !rawText) {
      const header = "MD\tInc\tAzi\n";
      const rows = existingData.map(p => `${p.md}\t${p.inc}\t${p.azi}`).join('\n');
      setRawText(header + rows);
      setConfig(prev => ({ ...prev, startLine: 2, delimiter: 'tab' }));
    }
  }, [existingData]);

  // Auto-detect startLine
  useEffect(() => {
    if (rawText && config.startLine === 2) {
      const lines = rawText.split('\n');
      for (let i = 0; i < Math.min(lines.length, 20); i++) {
        if (/^\s*[\d.,]+\s/.test(lines[i])) {
          setConfig(prev => ({ ...prev, startLine: i + 1 }));
          if (lines[i].includes(',') && !lines[i].includes('\t')) {
            setConfig(prev => ({ ...prev, delimiter: ',' }));
          }
          break;
        }
      }
    }
  }, [rawText]);

  const processFile = async (file) => {
    if (!file) return;
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    if (isExcel) {
      const XLSX = await import('xlsx');
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const text = XLSX.utils.sheet_to_csv(firstSheet, { FS: '\t' });
        setRawText(text);
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => setRawText(e.target.result);
      reader.readAsText(file);
    }
  };

  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget.contains(e.relatedTarget)) return; setIsDragging(false); };
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); if (!isDragging) setIsDragging(true); };
  const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); processFile(e.dataTransfer.files[0]); };
  const clearData = () => { setRawText(''); };

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h3 className="font-bold text-[#37424A] flex items-center gap-2"><MapPin className="text-[#00A99D]" /> Importér Brønnbane (Survey)</h3>
        <div className="flex gap-2 text-xs">
          <button className={`px-3 py-1 rounded border ${config.unitMultiplier === 1 ? 'bg-[#37424A] text-white' : 'bg-white'}`} onClick={() => setConfig({ ...config, unitMultiplier: 1 })}>Meter</button>
          <button className={`px-3 py-1 rounded border ${config.unitMultiplier !== 1 ? 'bg-[#37424A] text-white' : 'bg-white'}`} onClick={() => setConfig({ ...config, unitMultiplier: 0.3048 })}>Fot (ft)</button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-grow min-h-0">
        <div className="flex flex-col gap-4 h-full">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4 shrink-0">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[10px] uppercase font-bold text-gray-500">Start på linje</label><input type="number" className="w-full p-2 border rounded text-sm bg-white" value={config.startLine} onChange={e => setConfig({ ...config, startLine: isNaN(parseInt(e.target.value)) ? 1 : parseInt(e.target.value) })} /></div>
              <div><label className="text-[10px] uppercase font-bold text-gray-500">Skilletegn</label><select className="w-full p-2 border rounded text-sm bg-white" value={config.delimiter} onChange={e => setConfig({ ...config, delimiter: e.target.value })}><option value="auto">Auto (Space/Tab)</option><option value="tab">Tabulator</option><option value=",">Komma (,)</option><option value=";">Semikolon (;)</option></select></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[10px] uppercase font-bold text-gray-500">Tusenskilletegn</label><select className="w-full p-2 border rounded text-sm bg-white" value={config.thousandSep} onChange={e => setConfig({ ...config, thousandSep: e.target.value })}><option value="none">Ingen</option><option value="space">Mellomrom (1 000)</option><option value=".">Punktum (1.000)</option><option value=",">Komma (1,000)</option></select></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-[10px] uppercase font-bold text-gray-500">MD Kol</label><input type="number" className="w-full p-2 border rounded text-sm bg-white" value={config.colMD} onChange={e => setConfig({ ...config, colMD: parseInt(e.target.value) })} /></div>
              <div><label className="text-[10px] uppercase font-bold text-gray-500">Inc Kol</label><input type="number" className="w-full p-2 border rounded text-sm bg-white" value={config.colInc} onChange={e => setConfig({ ...config, colInc: parseInt(e.target.value) })} /></div>
              <div><label className="text-[10px] uppercase font-bold text-gray-500">Azi Kol</label><input type="number" className="w-full p-2 border rounded text-sm bg-white" value={config.colAzi} onChange={e => setConfig({ ...config, colAzi: parseInt(e.target.value) })} /></div>
            </div>
          </div>
          <div className={`flex-grow relative border-2 border-dashed rounded-lg transition-colors min-h-[200px] group ${isDragging ? 'border-[#00A99D] bg-teal-50' : 'border-gray-300 bg-gray-50 hover:bg-white'}`} onDrop={handleDrop} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}>
            {isDragging && (<div className="absolute inset-0 flex items-center justify-center bg-white/90 z-50 pointer-events-none rounded-lg"><p className="text-[#00A99D] font-bold text-lg">Slipp filen for å erstatte nåværende data</p></div>)}
            <textarea className="absolute inset-0 w-full h-full p-4 bg-transparent resize-none font-mono text-xs outline-none z-10" value={rawText} onChange={e => setRawText(e.target.value)} placeholder=" " />
            {!rawText && (<div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none"><div className="text-center pointer-events-auto"><FileSpreadsheet size={32} className="mx-auto mb-2 group-hover:text-[#37424A] transition-colors text-gray-400" /><p className="mb-2 text-gray-400">Dra og slipp tekst/excel fil her</p><button onClick={() => fileInputRef.current?.click()} className="bg-white border border-gray-300 px-3 py-1 rounded text-xs font-bold hover:bg-gray-50 shadow-sm cursor-pointer pointer-events-auto relative z-30">Eller velg fil</button><input type="file" ref={fileInputRef} className="hidden" accept=".txt,.csv,.xlsx,.xls" onChange={(e) => processFile(e.target.files[0])} /></div></div>)}
            {rawText && (<button onClick={clearData} className="absolute top-2 right-2 z-40 p-1 bg-white rounded-full shadow border border-gray-200 text-gray-400 hover:text-red-500" title="Tøm innhold"><X size={14} /></button>)}
          </div>
        </div>
        <div className="flex flex-col gap-4 h-full min-h-0">
          <div className="bg-white border rounded-lg flex-1 overflow-hidden flex flex-col">
            <div className="bg-gray-100 p-2 text-xs font-bold text-gray-600 border-b flex justify-between shrink-0"><span>Datapunkter</span>{parsedData.length > 0 && <span className="text-[#00A99D] flex items-center gap-1"><Check size={12} /> {parsedData.length} rader</span>}</div>
            <div className="flex-grow overflow-auto"><table className="w-full text-xs text-right"><thead className="bg-gray-50 sticky top-0"><tr><th className="p-2 text-gray-500">#</th><th className="p-2 text-[#37424A]">MD (m)</th><th className="p-2 text-[#37424A]">Inc (deg)</th><th className="p-2 text-[#37424A]">Azi (deg)</th></tr></thead><tbody className="font-mono">{parsedData.map((row, i) => (<tr key={i} className="border-b border-gray-100 hover:bg-yellow-50"><td className="p-2 text-gray-400">{i + 1}</td><td className="p-2">{row.md}</td><td className="p-2">{row.inc}</td><td className="p-2">{row.azi}</td></tr>))}</tbody></table></div>
          </div>
          <div className="bg-white border rounded-lg flex-1 flex flex-col overflow-hidden">
            <div className="bg-gray-100 p-2 text-xs font-bold text-gray-600 border-b flex justify-between items-center shrink-0"><span>Banevisualisering (3D)</span></div>
            <div className="flex-grow relative border border-gray-200 h-[400px]">{parsedData.length === 0 ? (<div className="absolute inset-0 flex items-center justify-center text-gray-300 text-xs">Ingen data å vise</div>) : (<div className="absolute inset-0 bg-white"><WellBore3D points={trajectory3D} /></div>)}</div>
          </div>
        </div>
      </div>
      <div className="flex justify-between pt-6 mt-2 border-t shrink-0">
        <button onClick={onBack} className="text-gray-500 font-medium">Tilbake</button>
        <button onClick={() => onNext(parsedData)} disabled={parsedData.length === 0} className={`px-6 py-2 rounded font-bold transition-colors ${parsedData.length > 0 ? 'bg-[#37424A] text-white hover:bg-slate-700' : 'bg-gray-200 text-gray-400'}`}>Bekreft Survey & Gå Videre</button>
      </div>
    </div>
  );
}

// --- COMPONENT: STEP ARCHITECTURE IMPORT (WITH UNIT TOGGLING & ID CALC) ---
function StepArchitectureImport({ onBack, onFinish, surveyData, initialData, maxDepth }) {
  const [sections, setSections] = useState([]);
  const [units, setUnits] = useState({ depth: 'm', id: 'cm', od: 'cm', weight: 'kg/m' });

  useEffect(() => {
    if (initialData && initialData.length > 0) setSections(initialData);
  }, [initialData]);

  const toggleUnit = (key) => {
    let nextUnits = { ...units };
    let currentUnit = units[key];
    let newUnit = currentUnit;
    let conversionFactor = 1;
    if (key === 'depth') { if (currentUnit === 'm') { newUnit = 'ft'; conversionFactor = 3.28084; } else { newUnit = 'm'; conversionFactor = 1 / 3.28084; } }
    else if (key === 'id' || key === 'od') { if (currentUnit === 'cm') { newUnit = 'in'; conversionFactor = 1 / 2.54; } else { newUnit = 'cm'; conversionFactor = 2.54; } }
    else if (key === 'weight') { if (currentUnit === 'kg/m') { newUnit = 'lb/ft'; conversionFactor = 0.671969; } else { newUnit = 'kg/m'; conversionFactor = 1 / 0.671969; } }
    nextUnits[key] = newUnit;
    setUnits(nextUnits);
    const updatedSections = sections.map(sec => {
      let newSec = { ...sec };
      if (key === 'depth') { newSec.start = parseFloat((sec.start * conversionFactor).toFixed(2)); newSec.end = parseFloat((sec.end * conversionFactor).toFixed(2)); }
      else if (key === 'od') { newSec.od = parseFloat((sec.od * conversionFactor).toFixed(3)); newSec.id = calculateIDFromODWeight(newSec.od, newSec.weight, newUnit, units.weight, units.id) || newSec.id; }
      else if (key === 'id') { newSec.id = parseFloat((sec.id * conversionFactor).toFixed(3)); }
      else if (key === 'weight') { newSec.weight = parseFloat((sec.weight * conversionFactor).toFixed(2)); newSec.id = calculateIDFromODWeight(newSec.od, newSec.weight, units.od, newUnit, units.id) || newSec.id; }
      return newSec;
    });
    setSections(updatedSections);
  };

  const addSection = () => {
    setSections([...sections, { start: sections.length > 0 ? sections[sections.length - 1].end : 0, end: 0, id: 0, od: 0, weight: 0, fricRodRIH: 1.0, fricRodPOOH: 1.0, fricToolRIH: 0.3, fricToolPOOH: 0.3 }]);
  };
  const removeSection = (idx) => { const newSec = [...sections]; newSec.splice(idx, 1); setSections(newSec); };
  const updateSection = (idx, field, value) => {
    const newSec = [...sections];
    newSec[idx][field] = parseFloat(value) || 0;
    if ((field === 'weight' || field === 'od')) {
      let newID = calculateIDFromODWeight(newSec[idx].od, newSec[idx].weight, units.od, units.weight, units.id);
      if (newID !== null) newSec[idx].id = newID;
    }
    setSections(newSec);
  };

  const exceedsMaxDepth = sections.some(s => s.end > maxDepth || s.start > maxDepth);

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-4 shrink-0"><h3 className="font-bold text-[#37424A] text-xl flex items-center gap-2">Brønnarkitektur Seksjoner</h3></div>
      <div className="flex gap-4 mb-4"><button onClick={addSection} className="bg-[#FFC82E] text-[#37424A] px-4 py-2 rounded font-bold text-xs hover:bg-[#E5B020] transition-colors flex items-center gap-2"><Plus size={16} /> LEGG TIL SEKSJON MANUELT</button></div>
      <div className="bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden flex-grow">
        <div className="flex bg-gray-50 text-gray-500 text-xs font-bold border-b border-gray-200">
          <div className="p-3 flex-1 border-r border-gray-100 cursor-pointer hover:text-[#37424A]" onClick={() => toggleUnit('depth')}>Fra ({units.depth})</div>
          <div className="p-3 flex-1 border-r border-gray-100 cursor-pointer hover:text-[#37424A]" onClick={() => toggleUnit('depth')}>Til ({units.depth})</div>
          <div className="p-3 flex-1 border-r border-gray-100 cursor-pointer hover:text-[#37424A]" onClick={() => toggleUnit('od')}>OD ({units.od})</div>
          <div className="p-3 flex-1 border-r border-gray-100 cursor-pointer hover:text-[#37424A]" onClick={() => toggleUnit('weight')}>Vekt ({units.weight})</div>
          <div className="p-3 flex-1 border-r border-gray-100 cursor-pointer hover:text-[#37424A]" onClick={() => toggleUnit('id')}>ID ({units.id})</div>
          <div className="p-3 flex-1 border-r border-gray-100">Rod RIH µ</div>
          <div className="p-3 flex-1 border-r border-gray-100">Rod POH µ</div>
          <div className="p-3 flex-1 border-r border-gray-100">Tool RIH µ</div>
          <div className="p-3 flex-1 border-r border-gray-100">Tool POOH µ</div>
          <div className="p-3 w-24 text-center">Handling</div>
        </div>
        <div className="overflow-y-auto flex-grow">
          {sections.map((sec, i) => (
            <div key={i} className="flex border-b border-gray-100 hover:bg-gray-50 transition-colors items-center">
              <div className="p-2 flex-1"><input type="number" className={`w-full border rounded px-2 py-1 text-sm ${sec.start > maxDepth ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} value={sec.start} onChange={e => updateSection(i, 'start', e.target.value)} /></div>
              <div className="p-2 flex-1"><input type="number" className={`w-full border rounded px-2 py-1 text-sm ${sec.end > maxDepth ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} value={sec.end} onChange={e => updateSection(i, 'end', e.target.value)} /></div>
              <div className="p-2 flex-1"><input type="number" className="w-full border border-gray-300 rounded px-2 py-1 text-sm" value={sec.od} onChange={e => updateSection(i, 'od', e.target.value)} /></div>
              <div className="p-2 flex-1"><input type="number" className="w-full border border-gray-300 rounded px-2 py-1 text-sm" value={sec.weight} onChange={e => updateSection(i, 'weight', e.target.value)} /></div>
              <div className="p-2 flex-1"><input type="number" className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-bold text-[#37424A]" value={sec.id} onChange={e => updateSection(i, 'id', e.target.value)} /></div>
              <div className="p-2 flex-1"><input type="number" step="0.1" className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-center" value={sec.fricRodRIH} onChange={e => updateSection(i, 'fricRodRIH', e.target.value)} /></div>
              <div className="p-2 flex-1"><input type="number" step="0.1" className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-center" value={sec.fricRodPOOH} onChange={e => updateSection(i, 'fricRodPOOH', e.target.value)} /></div>
              <div className="p-2 flex-1"><input type="number" step="0.1" className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-center" value={sec.fricToolRIH} onChange={e => updateSection(i, 'fricToolRIH', e.target.value)} /></div>
              <div className="p-2 flex-1"><input type="number" step="0.1" className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-center" value={sec.fricToolPOOH} onChange={e => updateSection(i, 'fricToolPOOH', e.target.value)} /></div>
              <div className="p-2 w-24 flex justify-center"><button onClick={() => removeSection(i)} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button></div>
            </div>
          ))}
          {sections.length === 0 && (<div className="p-8 text-center text-gray-400 text-sm flex flex-col items-center justify-center h-full"><Layers size={32} className="mb-2 opacity-20" />Ingen seksjoner lagt til. Trykk "Legg til seksjon manuelt" for å starte.</div>)}
        </div>
      </div>
      {exceedsMaxDepth && <div className="mt-2 text-red-500 font-bold text-sm flex items-center gap-2"><AlertTriangle size={16} /> Lengden på brønnarkitekturen kan ikke være lengre enn brønnen som er {maxDepth.toFixed(0)}m.</div>}
      <div className="flex justify-between pt-6 mt-2 border-t shrink-0"><button onClick={onBack} className="text-gray-500 font-medium">Tilbake</button><button onClick={() => onFinish(sections)} disabled={sections.length === 0 || exceedsMaxDepth} className={`px-6 py-2 rounded font-bold flex items-center gap-2 transition-colors ${sections.length > 0 && !exceedsMaxDepth ? 'bg-[#37424A] text-white hover:bg-slate-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}><Save size={18} /> Lagre Brønn</button></div>
    </div>
  );
}

// --- COMPONENT: CREATE WELL WIZARD ---
function CreateWellWizard({ onCancel, onSave, initialData }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState(initialData || {
    id: Math.random().toString(36).substr(2, 9),
    name: '', field: '', operator: 'Equinor',
    survey: [], architecture: []
  });

  // Survey Parsing State
  const [surveyText, setSurveyText] = useState('');
  const [surveyConfig, setSurveyConfig] = useState({ startLine: 1, delimiter: 'auto', colMD: 1, colInc: 2, colAzi: 3, unitMultiplier: 1, thousandSep: '.' });

  // Architecture State
  const [archSections, setArchSections] = useState(initialData?.architecture || []);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setArchSections(initialData.architecture || []);
      // Reverse engineer survey text if needed, or just keep empty if editing existing valid survey
    }
  }, [initialData]);

  const handleSurveyParse = () => {
    const parsed = parseSurveyData(surveyText, surveyConfig);
    if (parsed.length > 0) {
      setData({ ...data, survey: parsed });
      alert(`Suksess! ${parsed.length} punkter importert.`);
    } else {
      alert('Kunne ikke tolke data. Sjekk format og innstillinger.');
    }
  };

  const addArchSection = () => setArchSections([...archSections, { id: '', start: 0, end: 0, od: 0, weight: 0, grade: '', fricRodRIH: 0.25, fricRodPOOH: 0.25, fricToolRIH: 0.25, fricToolPOOH: 0.25 }]);
  const updateArchSection = (i, field, val) => { const newSecs = [...archSections]; newSecs[i][field] = val; setArchSections(newSecs); };
  const removeArchSection = (i) => { const newSecs = [...archSections]; newSecs.splice(i, 1); setArchSections(newSecs); };

  const handleFinalSave = () => {
    onSave({ ...data, architecture: archSections });
  };

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg overflow-hidden flex flex-col h-[80vh]">
      <div className="bg-[#37424A] text-white p-6 flex justify-between items-center shrink-0">
        <div><h2 className="text-xl font-bold">{initialData ? 'Rediger Brønn' : 'Ny Brønn'}</h2><p className="text-gray-400 text-sm">Steg {step} av 3</p></div>
        <div className="flex gap-2">
          {[1, 2, 3].map(s => <div key={s} className={`w-3 h-3 rounded-full ${step >= s ? 'bg-[#FFC82E]' : 'bg-gray-600'}`}></div>)}
        </div>
      </div>

      <div className="flex-grow overflow-y-auto p-8">
        {step === 1 && (
          <div className="space-y-6 max-w-lg mx-auto animate-in fade-in slide-in-from-right-8 duration-300">
            <h3 className="text-lg font-bold text-[#37424A] mb-4">Generell Informasjon</h3>
            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Brønn Navn</label><input type="text" className="w-full border p-3 rounded focus:border-[#FFC82E] outline-none" value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder="E.g. 34/10-A-12" /></div>
            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Felt</label><input type="text" className="w-full border p-3 rounded focus:border-[#FFC82E] outline-none" value={data.field} onChange={e => setData({ ...data, field: e.target.value })} placeholder="E.g. Gullfaks" /></div>
            <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Operatør</label><input list="operators" className="w-full border p-3 rounded focus:border-[#FFC82E] outline-none" value={data.operator} onChange={e => setData({ ...data, operator: e.target.value })} placeholder="Velg eller skriv inn operatør" /><datalist id="operators"><option value="Equinor" /><option value="Aker BP" /><option value="Vår Energi" /><option value="ConocoPhillips" /><option value="Shell" /><option value="TotalEnergies" /><option value="Neptune Energy" /><option value="Wintershall Dea" /></datalist></div>
          </div>
        )}

        {step === 2 && (
          <StepSurveyImport
            onBack={() => setStep(1)}
            onNext={(surveyData) => { setData({ ...data, survey: surveyData }); setStep(3); }}
            existingData={data.survey}
          />
        )}

        {step === 3 && (
          <StepArchitectureImport
            onBack={() => setStep(2)}
            onFinish={(archData) => { setData({ ...data, architecture: archData }); handleFinalSave(); }}
            surveyData={data.survey}
            initialData={archSections}
            maxDepth={data.survey.length > 0 ? Math.max(...data.survey.map(p => p.md)) : 10000}
          />
        )}
      </div>

      <div className="bg-gray-50 p-6 border-t border-gray-200 flex justify-between shrink-0">
        {step > 1 ? <button onClick={() => setStep(step - 1)} className="text-gray-500 font-bold hover:text-[#37424A]">Forrige</button> : <button onClick={onCancel} className="text-gray-500 font-bold hover:text-red-500">Avbryt</button>}
        {step < 3 ? <button onClick={() => setStep(step + 1)} disabled={step === 1 && !data.name} className={`px-6 py-2 rounded font-bold text-white ${step === 1 && !data.name ? 'bg-gray-300' : 'bg-[#37424A]'}`}>Neste</button> : <button onClick={handleFinalSave} className="bg-[#00A99D] text-white px-8 py-2 rounded font-bold hover:bg-teal-600 shadow-lg">Lagre Brønn</button>}
      </div>
    </div>
  );
}

// --- COMPONENT: WELL VIEW ---
function WellView({ well, onBack, onNewRun, onEditRun, onCopyRun, onDeleteRun }) {
  const [plotConfig, setPlotConfig] = useState({ x: 'vs', y: 'tvd' });

  const trajectory = useMemo(() => {
    const traj = calculateTrajectory(well.survey);
    return traj.map(p => ({
      ...p,
      north: -p.z, // Mapping: z is usually calculated as -N in standard calc logic used here
      east: p.x,
      vs: Math.sqrt(p.x * p.x + p.z * p.z) // Vertical Section / Horizontal Offset calculation
    }));
  }, [well.survey]);

  const plotData = useMemo(() => {
    // Transform data based on plotConfig
    return trajectory.map(p => {
      const getVal = (key) => {
        switch (key) {
          case 'md': return p.md;
          case 'tvd': return p.tvd;
          case 'vs': return p.vs;
          case 'north': return p.north;
          case 'east': return p.east;
          default: return 0;
        }
      };
      return { x: getVal(plotConfig.x), y: getVal(plotConfig.y), md: p.md };
    });
  }, [trajectory, plotConfig]);

  const options = [
    { value: 'md', label: 'Measured Depth (MD)' },
    { value: 'tvd', label: 'True Vertical Depth (TVD)' },
    { value: 'vs', label: 'Horizontal Offset (VS)' },
    { value: 'north', label: 'Distance North/South' },
    { value: 'east', label: 'Distance East/West' },
  ];

  // Invert Y axis if TVD is selected (standard oilfield plotting)
  const reversedY = plotConfig.y === 'tvd';

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex justify-between items-center">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-[#37424A] flex items-center gap-1 mb-4 shrink-0"><ArrowRight className="rotate-180" size={14} /> Tilbake til oversikt</button>
        <button onClick={onNewRun} className="bg-[#FFC82E] hover:bg-[#E5B020] text-[#37424A] font-bold py-2 px-6 rounded shadow-sm flex items-center gap-2 transition-colors">
          <Plus size={18} /> Nytt Run
        </button>
      </div>
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 shrink-0">
        <div className="flex justify-between items-start"><div><h1 className="text-3xl font-bold text-[#37424A]">{well.name}</h1><p className="text-gray-500">{well.field} • {well.operator}</p></div><div className="text-right"><div className="text-sm text-gray-400">Total Dybde</div><div className="text-xl font-mono font-bold">{Math.max(...well.survey.map(p => p.md), 0).toFixed(0)} m</div></div></div>

        {/* Row 1: Existing Plots */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8 h-64 border-b pb-8 mb-6">
          <div className="border rounded p-2"><h4 className="text-xs font-bold text-gray-500 mb-2 uppercase">Bane (Inklinasjon)</h4><ResponsiveContainer width="100%" height="90%"><AreaChart data={well.survey}><defs><linearGradient id="colorInc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#FFC82E" stopOpacity={0.8} /><stop offset="95%" stopColor="#FFC82E" stopOpacity={0} /></linearGradient></defs><XAxis dataKey="md" unit="m" style={{ fontSize: '10px' }} /><YAxis unit="°" style={{ fontSize: '10px' }} /><CartesianGrid strokeDasharray="3 3" /><Tooltip /><Area type="monotone" dataKey="inc" stroke="#FFC82E" fillOpacity={1} fill="url(#colorInc)" /></AreaChart></ResponsiveContainer></div>
          <div className="border rounded p-2 relative"><h4 className="text-xs font-bold text-gray-500 mb-2 uppercase">Arkitektur (Indre Diameter)</h4><div className="h-full w-full overflow-y-auto space-y-1 pr-2 pb-6">{well.architecture.map((sec, i) => (<div key={i} className="flex items-center gap-2 text-xs"><div className="w-16 text-right font-mono text-gray-400">{sec.start.toFixed(0)}m</div><div className="h-6 bg-[#37424A] rounded-r flex items-center px-2 text-white relative transition-all hover:bg-[#00A99D]" style={{ width: `${Math.min(sec.id * 10, 100)}%` }} >{sec.id}"</div><div className="flex-grow border-b border-dotted border-gray-300"></div><div className="w-16 font-mono text-gray-400">{sec.end.toFixed(0)}m</div></div>))}</div></div>
        </div>

        {/* Row 2: NEW PLOTS (3D & Configurable 2D) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-96">
          {/* 3D Plot Container */}
          <div className="border rounded-lg p-2 bg-gray-50 relative flex flex-col overflow-hidden">
            <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase absolute top-2 left-2 z-10 bg-white/80 px-2 py-1 rounded shadow-sm">3D Brønnbane (Interaktiv)</h4>
            <div className="flex-grow relative border border-gray-200 bg-white rounded">
              <WellBore3D points={trajectory} architecture={well.architecture} />
            </div>
          </div>

          {/* Configurable 2D Plot Container */}
          <div className="border rounded-lg p-2 flex flex-col">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-xs font-bold text-gray-500 uppercase">Dynamisk 2D Plot</h4>
              <div className="flex gap-2 text-xs">
                <select className="border rounded p-1" value={plotConfig.x} onChange={e => setPlotConfig({ ...plotConfig, x: e.target.value })}>
                  {options.map(o => <option key={o.value} value={o.value}>X: {o.label}</option>)}
                </select>
                <select className="border rounded p-1" value={plotConfig.y} onChange={e => setPlotConfig({ ...plotConfig, y: e.target.value })}>
                  {options.map(o => <option key={o.value} value={o.value}>Y: {o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex-grow">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="x" name={options.find(o => o.value === plotConfig.x)?.label} style={{ fontSize: '10px' }} label={{ value: options.find(o => o.value === plotConfig.x)?.label, position: 'insideBottom', offset: -10 }} />
                  <YAxis type="number" dataKey="y" name={options.find(o => o.value === plotConfig.y)?.label} reversed={reversedY} style={{ fontSize: '10px' }} label={{ value: options.find(o => o.value === plotConfig.y)?.label, angle: -90, position: 'insideLeft' }} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-white border p-2 rounded shadow text-xs">
                          <p>{`${options.find(o => o.value === plotConfig.x)?.label}: ${payload[0].value.toFixed(1)}`}</p>
                          <p>{`${options.find(o => o.value === plotConfig.y)?.label}: ${payload[1].value.toFixed(1)}`}</p>
                          <p className="text-gray-500">{`MD: ${payload[0].payload.md.toFixed(1)}m`}</p>
                        </div>
                      );
                    }
                    return null;
                  }} />
                  <Scatter name="Well Path" data={plotData} fill="#37424A" line={{ stroke: '#37424A', strokeWidth: 2 }} shape="circle" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex-grow overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h3 className="font-semibold text-gray-700 flex items-center gap-2"><Activity size={18} /> Tilhørende Jobber (Runs)</h3>
        </div>
        <div className="flex-grow overflow-auto p-4">
          {(!well.jobs || well.jobs.length === 0) ?
            <p className="text-sm text-gray-500 text-center mt-10">Ingen jobber opprettet for denne brønnen enda.</p>
            :
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-200">
                <tr><th className="px-6 py-3">Mål</th><th className="px-6 py-3">Dybde</th><th className="px-6 py-3">Dato</th><th className="px-6 py-3 text-right">Handling</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {well.jobs.map(job => (
                  <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">{job.general?.goal}</td>
                    <td className="px-6 py-4">{job.general?.targetDepth} m</td>
                    <td className="px-6 py-4">{job.date}</td>
                    <td className="px-6 py-4 text-right flex justify-end gap-2">
                      <button onClick={() => onEditRun(job)} className="p-1.5 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded" title="Rediger"><Edit2 size={16} /></button>
                      <button onClick={() => onCopyRun(job)} className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded" title="Kopier"><Copy size={16} /></button>
                      <button onClick={() => exportToComtrac(well, job)} className="p-1.5 hover:bg-green-50 text-gray-400 hover:text-green-600 rounded" title="Last ned XML"><Download size={16} /></button>
                      <button onClick={() => onDeleteRun(job.id)} className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded" title="Slett"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        </div>
      </div>
    </div>
  );
}
