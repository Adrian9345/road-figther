/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Zap, Fuel, AlertTriangle, Play, RotateCcw, Flag, BookOpen, Map as MapIcon, ChevronLeft, ChevronRight, ArrowUp } from 'lucide-react';

// Constants
const ROAD_WIDTH = 260;
const CAR_WIDTH = 30;
const CAR_HEIGHT = 50;
const INITIAL_FUEL = 100;
const FUEL_CONSUMPTION_RATE = 0.04;
const MAX_SPEED = 6; // 60 km/h
const MIN_SPEED = 3;  // 30 km/h
const ACCELERATION = 0.05;
const DECELERATION = 0.04;
const BRAKE_FORCE = 0.8;
const SIDE_SPEED = 1.2; // Increased for snappier, "shorter" response
const TOTAL_RACE_DISTANCE = 3000; // 30km (100 units = 1km)

type Entity = {
  id: number;
  x: number;
  y: number;
  laneOffset: number;
  angle: number;
  type: 'enemy' | 'fuel' | 'obstacle' | 'rival' | 'marker' | 'oil' | 'pothole';
  color: string;
  speedMultiplier: number;
  isStartingRival?: boolean;
  markerValue?: number;
  isSlipping?: boolean;
};

export default function App() {
  const [gameState, setGameState] = useState<'start' | 'countdown' | 'playing' | 'gameover'>('start');
  const [canvasRect, setCanvasRect] = useState({ width: 390, height: 500 });
  const displayWidthRef = useRef(390);
  const displayHeightRef = useRef(500);

  // ResizeObserver to detect container dimensions dynamically
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      
      displayWidthRef.current = w || 390;
      displayHeightRef.current = h || 500;
      setCanvasRect({ width: w || 390, height: h || 500 });
    };

    handleResize();

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const [countdown, setCountdown] = useState(3);
  const [uiScore, setUiScore] = useState(0);
  const [uiDistance, setUiDistance] = useState(0);
  const [uiFuel, setUiFuel] = useState(INITIAL_FUEL);
  const [uiSpeed, setUiSpeed] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [gameOverView, setGameOverView] = useState<'main' | 'map' | 'narrative'>('main');
  
  // Drift states for UI feedback
  const [uiActiveDriftScore, setUiActiveDriftScore] = useState(0);
  const [uiActiveDriftCombo, setUiActiveDriftCombo] = useState(0);
  const [uiIsDrifting, setUiIsDrifting] = useState(false);
  const [uiShowDriftPayout, setUiShowDriftPayout] = useState(0);
  const [uiShowDriftMsg, setUiShowDriftMsg] = useState('');
  const [uiCurvature, setUiCurvature] = useState(0);
  
  // Interactive steering wheel state & ref
  const [uiWheelAngle, setUiWheelAngle] = useState(0);
  const wheelAngleRef = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(null);
  const frameCounterRef = useRef(0);
  
  const speedRef = useRef(0);
  const sideVelocity = useRef(0);
  const fuelRef = useRef(INITIAL_FUEL);
  const distanceRef = useRef(0);
  const scoreRef = useRef(0);
  const playerPos = useRef({ x: 390 / 2, y: 500 - 120 });
  const playerAngle = useRef(0);
  const entities = useRef<Entity[]>([]);
  const keys = useRef<{ [key: string]: boolean }>({});
  const roadCurve = useRef(0);
  const targetCurve = useRef(0);
  const curveTimer = useRef(0);
  const lastTime = useRef(0);
  const entityIdCounter = useRef(0);
  const trackCurvature = useRef<number[]>([]);
  const cameraAngleRef = useRef(0);
  const cameraSlideRef = useRef(0);

  // High-performance drift loop refs
  const isDriftingRef = useRef(false);
  const driftDirectionRef = useRef<0 | -1 | 1>(0);
  const driftAngleRef = useRef(0);
  const driftScoreRef = useRef(0);
  const driftComboRef = useRef(0);
  const particlesRef = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
    color: string;
    decay: number;
    isSpark?: boolean;
  }[]>([]);

  // Helper to get road curvature at a specific distance
  const getRoadCurveAtDistance = (distance: number) => {
    if (distance < 0) return 0;
    const segmentSize = 100;
    const index = Math.floor(distance / segmentSize);
    const nextIndex = trackCurvature.current.length > 0 ? Math.min(index + 1, trackCurvature.current.length - 1) : 0;
    const t = (distance % segmentSize) / segmentSize;
    
    const c1 = trackCurvature.current[index] || 0;
    const c2 = trackCurvature.current[nextIndex] || 0;
    return c1 + (c2 - c1) * t;
  };

  // Helper vectors for rendering responsive HTML-based SVG track paths
  const generateMinimapPath = (width: number, height: number) => {
    if (trackCurvature.current.length === 0) return '';
    const points: string[] = [];
    const totalPoints = 100; // Increased points for smoother minimap
    for (let i = 0; i <= totalPoints; i++) {
      const dist = (i / totalPoints) * TOTAL_RACE_DISTANCE;
      const curve = getRoadCurveAtDistance(dist);
      // Increased scaling to fit the entire track curvature range
      const relativeX = curve / 4000; 
      const x = width / 2 + relativeX * (width / 2 - 5);
      const y = height - (i / totalPoints) * height;
      if (i === 0) points.push(`M ${x} ${y}`);
      else points.push(`L ${x} ${y}`);
    }
    return points.join(' ');
  };

  const getPlayerMinimapCoords = (width: number, height: number) => {
    const progress = Math.min(uiDistance / TOTAL_RACE_DISTANCE, 1);
    const y = height - (progress * height);
    const currentCurve = getRoadCurveAtDistance(uiDistance);
    const pRelativeX = currentCurve / 450;
    const x = width / 2 + pRelativeX * (width / 2 - 5);
    return { x, y };
  };

  // Helper to get road center at a specific Y coordinate with flat top-down birds-eye projection
  const getRoadXAt = (y: number, distance: number) => {
    const CANVAS_WIDTH = displayWidthRef.current;
    const CANVAS_HEIGHT = displayHeightRef.current;
    const baseOffset = (CANVAS_WIDTH - ROAD_WIDTH) / 2;
    
    // In a flat 2D top-down bird's-eye (cenital) view, distance ahead maps linearly with screen y coordinate:
    const lookAheadFactor = (CANVAS_HEIGHT - y) / CANVAS_HEIGHT; // 0 (bottom) to 1 (top)
    
    // Look ahead farther on the track (zoomed out to look up to 340 pixels ahead into future curves)
    const distAhead = lookAheadFactor * 340;
    
    const currentCurveVal = getRoadCurveAtDistance(distance);
    const targetCurveVal = getRoadCurveAtDistance(distance + distAhead);
    
    // Scale curve offset to fit the view nicely and provide beautiful horizontal curves
    const curveOffset = (targetCurveVal - currentCurveVal) * 0.15;
    
    return baseOffset + curveOffset;
  };

  const getRoadAngleAt = (y: number, distance: number) => {
    const CANVAS_HEIGHT = displayHeightRef.current;
    const worldDistance = distance + (CANVAS_HEIGHT - y) / 100;
    const curve = getRoadCurveAtDistance(worldDistance);
    
    // Adjusted derivative for gentler curves
    const derivative = Math.cos((y - distance * 100) * 0.001) * 0.0005 * curve;
    return Math.atan(derivative);
  };

  const spawnEntity = useCallback((isRival = false, initialY = -100, laneIndex?: number) => {
    const id = entityIdCounter.current++;
    const typeRand = Math.random();
    let type: Entity['type'] = isRival ? 'rival' : 'enemy';
    let color = isRival ? '#facc15' : '#ef4444'; 
    let speedMultiplier = isRival ? 0.8 + Math.random() * 0.4 : 0.6 + Math.random() * 0.4;

    if (!isRival) {
      if (typeRand > 0.9) {
        type = 'fuel';
        color = '#22c55e';
        speedMultiplier = 0.3;
      } else if (typeRand > 0.8) {
        type = 'obstacle';
        color = '#f59e0b';
        speedMultiplier = 0;
      } else if (typeRand > 0.7) {
        type = 'oil';
        color = '#111';
        speedMultiplier = 0;
      } else if (typeRand > 0.6) {
        type = 'pothole';
        color = '#713f12'; // Brownish for leaves/dirt
        speedMultiplier = 0;
      }
    }

    // For starting rivals, we use fixed lanes
    let laneOffset;
    if (laneIndex !== undefined) {
      const laneWidth = ROAD_WIDTH / 2;
      laneOffset = laneIndex * laneWidth + (laneWidth - CAR_WIDTH) / 2;
    } else {
      laneOffset = 20 + Math.random() * (ROAD_WIDTH - CAR_WIDTH - 40);
    }

    // Prevent overlapping
    const isOverlapping = entities.current.some(e => 
      Math.abs(e.y - initialY) < 100 && Math.abs(e.laneOffset - laneOffset) < 50
    );
    if (isOverlapping && laneIndex === undefined) return;

    const roadX = getRoadXAt(initialY, distanceRef.current);

    entities.current.push({
      id,
      x: roadX + laneOffset,
      y: initialY,
      laneOffset,
      angle: 0,
      type,
      color,
      speedMultiplier,
      isStartingRival: isRival
    });
  }, []);

  const startGameSequence = () => {
    const CANVAS_WIDTH = displayWidthRef.current;
    const CANVAS_HEIGHT = displayHeightRef.current;

    setGameState('countdown');
    setCountdown(3);
    
    setUiScore(0);
    setUiDistance(0);
    setUiFuel(INITIAL_FUEL);
    setUiSpeed(0);
    
    speedRef.current = 0;
    fuelRef.current = INITIAL_FUEL;
    distanceRef.current = 0;
    scoreRef.current = 0;
    
    playerPos.current = { x: CANVAS_WIDTH / 2 - CAR_WIDTH / 2, y: CANVAS_HEIGHT - 120 };
    playerAngle.current = 0;
    setIsSpinning(false);
    setGameOverView('main');
    sideVelocity.current = 0;
    entities.current = [];
    roadCurve.current = 0;
    targetCurve.current = 0;
    curveTimer.current = 0;
    cameraAngleRef.current = 0;
    cameraSlideRef.current = 0;

    // Reset drift variables
    isDriftingRef.current = false;
    driftDirectionRef.current = 0;
    driftAngleRef.current = 0;
    driftScoreRef.current = 0;
    driftComboRef.current = 0;
    particlesRef.current = [];
    wheelAngleRef.current = 0;
    setUiWheelAngle(0);
    setUiActiveDriftScore(0);
    setUiActiveDriftCombo(0);
    setUiIsDrifting(false);
    setUiShowDriftPayout(0);
    setUiShowDriftMsg('');

    // Generate Track Data: Fluid circuit with sinusoidal curves
    const segmentSize = 100;
    const totalSegments = Math.ceil(TOTAL_RACE_DISTANCE / segmentSize) + 10;
    trackCurvature.current = new Array(totalSegments).fill(0);
    
    for (let i = 0; i < totalSegments; i++) {
        // Straight start for the first 20 segments (2000 units), then curves
        if (i < 20) {
            trackCurvature.current[i] = 0;
        } else {
            trackCurvature.current[i] = Math.sin(i * 0.25) * 1200 + Math.sin(i * 0.08) * 800;
        }
    }
    
    // Extra smoothing
    for (let i = 5; i < totalSegments - 5; i++) {
      let sum = 0;
      for (let j = -5; j <= 5; j++) sum += trackCurvature.current[i + j];
      trackCurvature.current[i] = sum / 11;
    }
    
    // Setup Starting Grid: 9 rivals in front, player car at the very back
    const gridStartY = 300; // Starting line reference (higher up)
    
    for (let i = 0; i < 9; i++) {
        const row = Math.floor(i / 2) + 1; 
        const col = i % 2;
        // Rivals ahead of player (smaller Y)
        const yOffset = gridStartY - (row * 50); 
        spawnEntity(true, yOffset, col);
    }
    
    // Player at the back (larger Y)
    playerPos.current = { x: CANVAS_WIDTH / 2 - CAR_WIDTH / 2, y: gridStartY + 40 };
    
    containerRef.current?.focus();
  };

  useEffect(() => {
    if (gameState === 'countdown') {
      draw();
      if (countdown > 0) {
        const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
        return () => clearTimeout(timer);
      } else {
        setGameState('playing');
        lastTime.current = performance.now();
      }
    }
  }, [gameState, countdown]);

  useEffect(() => {
    // Pre-initialize track configuration on mount
    const segmentSize = 100;
    const totalSegments = Math.ceil(TOTAL_RACE_DISTANCE / segmentSize) + 10;
    trackCurvature.current = new Array(totalSegments).fill(0);
    
    for (let i = 0; i < totalSegments; i++) {
        // Straight start for the first 20 segments (2000 units), then curves
        if (i < 20) {
            trackCurvature.current[i] = 0;
        } else {
            trackCurvature.current[i] = Math.sin(i * 0.25) * 1200 + Math.sin(i * 0.08) * 800;
        }
    }
    
    // Extra smoothing
    for (let i = 5; i < totalSegments - 5; i++) {
      let sum = 0;
      for (let j = -5; j <= 5; j++) sum += trackCurvature.current[i + j];
      trackCurvature.current[i] = sum / 11;
    }
  }, []);

  const update = (time: number) => {
    const CANVAS_WIDTH = displayWidthRef.current;
    const CANVAS_HEIGHT = displayHeightRef.current;

    const deltaTime = time - lastTime.current;
    lastTime.current = time;

    // Handle Input
    const isUp = keys.current['arrowup'] || keys.current['w'];
    const isDown = keys.current['arrowdown'] || keys.current['s'];
    const isLeft = keys.current['arrowleft'] || keys.current['a'];
    const isRight = keys.current['arrowright'] || keys.current['d'];
    const isBrake = keys.current[' '] || keys.current['spacebar'];

    if (isSpinning) {
      playerAngle.current += 0.8; // Even faster, brusco spin
      speedRef.current = Math.max(speedRef.current - 0.4, 0);
      // Drift wildly and push off-road
      playerPos.current.x += Math.sin(playerAngle.current * 10) * 15;
      playerPos.current.x += (playerPos.current.x > CANVAS_WIDTH / 2 ? 5 : -5);
      
      if (speedRef.current === 0) {
        setGameState('gameover');
      }
    } else {
      if (isBrake) {
        speedRef.current = Math.max(speedRef.current - BRAKE_FORCE, MIN_SPEED);
      } else if (isUp) {
        speedRef.current = Math.min(speedRef.current + ACCELERATION, MAX_SPEED);
      } else if (isDown) {
        speedRef.current = Math.max(speedRef.current - DECELERATION * 2, MIN_SPEED);
      } else {
        speedRef.current = Math.max(speedRef.current - DECELERATION, MIN_SPEED);
      }

      // Smooth steering with acceleration/friction and calculate visual wheel rotation
      const targetWheelAngle = isLeft ? -95 : (isRight ? 95 : 0);
      wheelAngleRef.current += (targetWheelAngle - wheelAngleRef.current) * 0.16;

      if (isLeft) {
        sideVelocity.current -= SIDE_SPEED;
      } else if (isRight) {
        sideVelocity.current += SIDE_SPEED;
      } else {
        sideVelocity.current *= isDriftingRef.current ? 0.94 : 0.7; // Sustain side slide momentum when drifting!
      }
      
      // Limit side velocity
      const maxSideVel = 6 * (speedRef.current / MAX_SPEED + 0.2);
      sideVelocity.current = Math.max(Math.min(sideVelocity.current, maxSideVel), -maxSideVel);
      
      playerPos.current.x += sideVelocity.current;

      // --- DRIFT MECHANIC ---
      const canDrift = speedRef.current > 4 && (isLeft || isRight);
      const roadCurveVal = getRoadCurveAtDistance(distanceRef.current);
      const isSteeringInCurve = Math.abs(roadCurveVal) > 65 && 
        ((roadCurveVal > 0 && isRight) || (roadCurveVal < 0 && isLeft));

      // Drift is triggered by holding handbrake (space/brake pedal) or hard steering inside S-curves
      if (canDrift && (isBrake || isSteeringInCurve)) {
        if (!isDriftingRef.current) {
          isDriftingRef.current = true;
          driftDirectionRef.current = isLeft ? -1 : 1;
          // Sideways snap force
          sideVelocity.current += driftDirectionRef.current * 1.5;
        }
      }

      // Manage drift updates
      if (isDriftingRef.current) {
        // If speed drops too low, or they center steering completely, drift finishes
        if (speedRef.current < 3.2 || (!isLeft && !isRight)) {
          if (driftScoreRef.current > 0) {
            const payout = driftScoreRef.current;
            scoreRef.current += payout;
            setUiActiveDriftScore(0);
            setUiShowDriftPayout(payout);
            
            let msg = 'SLOW IN OUT';
            if (payout > 1800) msg = '👑 DRIFT KING!';
            else if (payout > 1000) msg = '🔥 MEGA DRIFT!';
            else if (payout > 450) msg = '⭐ SUPER DRIFT';
            else if (payout > 150) msg = 'CLEAN SLIDE';
            setUiShowDriftMsg(msg);

            setTimeout(() => {
              setUiShowDriftPayout(prev => {
                if (prev === payout) {
                  setUiShowDriftMsg('');
                  return 0;
                }
                return prev;
              });
            }, 2300);
          }
          isDriftingRef.current = false;
          driftDirectionRef.current = 0;
          driftScoreRef.current = 0;
          driftComboRef.current = 0;
        } else {
          // Lock the direction to current steering input
          if (isLeft) driftDirectionRef.current = -1;
          if (isRight) driftDirectionRef.current = 1;

          // Apply small physical centrifugal slide push
          const centerPush = driftDirectionRef.current * 0.24 * (speedRef.current / MAX_SPEED);
          playerPos.current.x += centerPush;

          // Reward accumulative score
          driftScoreRef.current += Math.floor(speedRef.current * 1.6 + Math.abs(sideVelocity.current) * 1.4);
          driftComboRef.current += 1;

          if (driftComboRef.current % 3 === 0) {
            setUiActiveDriftScore(driftScoreRef.current);
          }
        }
      }
    }

    // Smooth Player Angle (Road Curve + Steering Tilt + Drift Body Yaw)
    const targetPlayerAngle = getRoadAngleAt(playerPos.current.y + CAR_HEIGHT / 2, distanceRef.current);
    const steeringTilt = isLeft ? -0.06 : (isRight ? 0.06 : 0);
    
    // Smooth interpolation for drifting chassis yaw (car points sideways relative to travel)
    const targetDriftYaw = isDriftingRef.current 
      ? (driftDirectionRef.current === -1 ? -0.42 : 0.42)
      : 0;
    driftAngleRef.current += (targetDriftYaw - driftAngleRef.current) * 0.12;

    playerAngle.current += (targetPlayerAngle + steeringTilt - playerAngle.current) * 0.08;

    // Road Curving Logic
    roadCurve.current = getRoadCurveAtDistance(distanceRef.current);

    // Apply Drift based on road curvature
    const driftForce = roadCurve.current * 0.005 * (speedRef.current / MAX_SPEED);
    playerPos.current.x -= driftForce;

    // Boundary check based on current Y position with wall collision penalties during drift
    const currentRoadX = getRoadXAt(playerPos.current.y, distanceRef.current);
    const hitLeftWall = playerPos.current.x <= currentRoadX + 11;
    const hitRightWall = playerPos.current.x >= currentRoadX + ROAD_WIDTH - CAR_WIDTH - 11;

    if (playerPos.current.x < currentRoadX + 10) {
      playerPos.current.x = currentRoadX + 10;
    }
    if (playerPos.current.x > currentRoadX + ROAD_WIDTH - CAR_WIDTH - 10) {
      playerPos.current.x = currentRoadX + ROAD_WIDTH - CAR_WIDTH - 10;
    }

    // High speed wall-rubbing cancels active drifts and cuts points
    if ((hitLeftWall || hitRightWall) && isDriftingRef.current) {
      if (driftScoreRef.current > 50) {
        const partialPayout = Math.floor(driftScoreRef.current * 0.25);
        scoreRef.current += partialPayout;
        setUiActiveDriftScore(0);
        setUiShowDriftPayout(partialPayout);
        setUiShowDriftMsg('💥 BARRA DE CHOQUE! (25%)');

        setTimeout(() => {
          setUiShowDriftMsg('');
          setUiShowDriftPayout(0);
        }, 1800);
      }
      isDriftingRef.current = false;
      driftDirectionRef.current = 0;
      driftScoreRef.current = 0;
      driftComboRef.current = 0;
    }

    // --- drift particles update ---
    particlesRef.current.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.y += speedRef.current * 0.65; // move downwards relative to road speed
      p.alpha -= p.decay;
      if (p.isSpark) {
        p.size *= 0.94;
      } else {
        p.size += 0.28;
      }
    });
    particlesRef.current = particlesRef.current.filter(p => p.alpha > 0);

    // Spawn smoke & spark particles from rear tires
    if (isDriftingRef.current && speedRef.current > 2) {
      const compositeAngle = playerAngle.current + driftAngleRef.current;
      const cosA = Math.cos(compositeAngle);
      const sinA = Math.sin(compositeAngle);

      const rLeftX = playerPos.current.x + CAR_WIDTH / 2 + (-CAR_WIDTH / 2 + 5) * cosA - (CAR_HEIGHT / 2 - 4) * sinA;
      const rLeftY = playerPos.current.y + CAR_HEIGHT / 2 + (-CAR_WIDTH / 2 + 5) * sinA + (CAR_HEIGHT / 2 - 4) * cosA;

      const rRightX = playerPos.current.x + CAR_WIDTH / 2 + (CAR_WIDTH / 2 - 5) * cosA - (CAR_HEIGHT / 2 - 4) * sinA;
      const rRightY = playerPos.current.y + CAR_HEIGHT / 2 + (CAR_WIDTH / 2 - 5) * sinA + (CAR_HEIGHT / 2 - 4) * cosA;

      const tires = [{ x: rLeftX, y: rLeftY }, { x: rRightX, y: rRightY }];
      tires.forEach(tire => {
        // Smoke cloud (glowing light cyan neon tire smoke)
        particlesRef.current.push({
          x: tire.x,
          y: tire.y,
          vx: -(sideVelocity.current * 0.15) + (Math.random() - 0.5) * 1.2,
          vy: Math.random() * 0.4 + 0.1,
          size: Math.random() * 2.5 + 3.0,
          alpha: 0.35 + Math.random() * 0.12,
          color: '165, 243, 252',
          decay: Math.random() * 0.016 + 0.011
        });

        // Glowing friction sparks
        if (Math.random() < 0.68) {
          particlesRef.current.push({
            x: tire.x,
            y: tire.y,
            vx: -sideVelocity.current * 0.35 + (Math.random() - 0.5) * 4.0,
            vy: -Math.random() * 1.8 - 0.6,
            size: Math.random() * 1.3 + 1.2,
            alpha: 1.0,
            color: Math.random() > 0.5 ? '250, 204, 21' : '239, 68, 68',
            decay: Math.random() * 0.045 + 0.026,
            isSpark: true
          });
        }
      });
    }

    // Update Distance and Fuel
    if (speedRef.current > 0) {
      distanceRef.current += speedRef.current * 0.01;
      fuelRef.current -= (speedRef.current / MAX_SPEED) * FUEL_CONSUMPTION_RATE;
      
      if (fuelRef.current <= 0) {
        fuelRef.current = 0;
        setGameState('gameover');
        return;
      }
    }

    // Update Entities
    entities.current.forEach(entity => {
      // Rivals accelerate faster at the start
      const rivalBoost = entity.type === 'rival' ? 4 : 0;
      entity.y += (speedRef.current - (entity.speedMultiplier * speedRef.current * 0.5)) - rivalBoost;
      
      // Basic AI for rivals and enemies to dodge obstacles
      if (entity.type === 'rival' || entity.type === 'enemy') {
        const ahead = entities.current.filter(e => 
          e.id !== entity.id && 
          e.y < entity.y && 
          e.y > entity.y - 200 && 
          Math.abs(e.laneOffset - entity.laneOffset) < 60
        );
        
        if (ahead.length > 0) {
          // Dodge logic
          const obstacle = ahead[0];
          if (entity.laneOffset < obstacle.laneOffset) {
            entity.laneOffset -= 2;
          } else {
            entity.laneOffset += 2;
          }
          // Clamp to road
          entity.laneOffset = Math.max(20, Math.min(ROAD_WIDTH - CAR_WIDTH - 20, entity.laneOffset));
        }
      }

      // Update X based on laneOffset and current road curve at its Y
      const entRoadX = getRoadXAt(entity.y, distanceRef.current);
      entity.x = entRoadX + entity.laneOffset;

      // Smooth Entity Angle
      const targetEntityAngle = getRoadAngleAt(entity.y + CAR_HEIGHT / 2, distanceRef.current);
      // Smoother entity angle transition: reduced factor from 0.1 to 0.05
      entity.angle += (targetEntityAngle - entity.angle) * 0.05;

      // Collision detection
      const collisionPadding = entity.type === 'oil' || entity.type === 'pothole' ? 20 : 0;
      if (
        playerPos.current.x < entity.x + CAR_WIDTH + collisionPadding &&
        playerPos.current.x + CAR_WIDTH > entity.x - collisionPadding &&
        playerPos.current.y < entity.y + CAR_HEIGHT + collisionPadding &&
        playerPos.current.y + CAR_HEIGHT > entity.y - collisionPadding
      ) {
        if (entity.type === 'fuel') {
          fuelRef.current = Math.min(fuelRef.current + 30, INITIAL_FUEL);
          scoreRef.current += 150;
          entity.y = CANVAS_HEIGHT + 200; 
        } else if (entity.type === 'marker') {
          scoreRef.current += 50;
          entity.y = CANVAS_HEIGHT + 200;
          // No speed reduction for markers
        } else if (entity.type === 'obstacle') {
          // Dark yellow obstacle - no speed reduction
          scoreRef.current += 100;
          entity.y = CANVAS_HEIGHT + 200;
        } else if (entity.type === 'oil') {
          // Slip and crash immediately with a more violent reaction
          setIsSpinning(true);
          speedRef.current = Math.max(speedRef.current, 10); // Ensure some speed for the spin
          entity.y = CANVAS_HEIGHT + 200;
        } else if (entity.type === 'pothole') {
          // Pothole crash - immediate lose
          speedRef.current = 0;
          setGameState('gameover');
          entity.y = CANVAS_HEIGHT + 200;
        } else {
          // Only brake for enemies or rivals
          speedRef.current = 0;
          entity.y = CANVAS_HEIGHT + 200;
          if (fuelRef.current <= 0) {
            fuelRef.current = 0;
            setGameState('gameover');
            return;
          }
        }
      }
    });

    entities.current = entities.current.filter(e => e.y < CANVAS_HEIGHT + 100 && e.y > -500);

    // Spawn mileage markers every 500 units (5km)
    if (Math.floor(distanceRef.current / 500) > Math.floor((distanceRef.current - speedRef.current * 0.01) / 500)) {
      const id = entityIdCounter.current++;
      const roadX = getRoadXAt(-100, distanceRef.current);
      // Place sign on the left or right side outside the road (further into the grass)
      const side = Math.random() > 0.5 ? 1 : -1;
      const laneOffset = side === 1 ? ROAD_WIDTH + 14 : -13;
      const markerValue = Math.floor(distanceRef.current / 100); // Show km
      
      entities.current.push({
        id,
        x: roadX + laneOffset,
        y: -100,
        laneOffset,
        angle: 0,
        type: 'marker',
        color: '#fff',
        speedMultiplier: 0,
        markerValue
      });
    }

    if (Math.random() < 0.03 && entities.current.length < 7) {
      spawnEntity();
    }

    // Throttle React slate updates to keep the game performance butter-smooth at a solid 60 FPS
    frameCounterRef.current++;
    if (frameCounterRef.current % 5 === 0) {
      setUiSpeed(speedRef.current);
      setUiFuel(fuelRef.current);
      setUiDistance(distanceRef.current);
      setUiScore(scoreRef.current);
      setUiWheelAngle(wheelAngleRef.current);
      setUiActiveDriftCombo(driftComboRef.current);
      setUiIsDrifting(isDriftingRef.current);

      const lookAheadCurve = getRoadCurveAtDistance(distanceRef.current + 35);
      setUiCurvature(lookAheadCurve);
    }

    // Center the camera on the track and align its angle with the heading of the road (dirección de la vía)
    const playerY = playerPos.current.y;
    
    // Road center at two positions to calculate the local segment's tangent heading/direction
    const yRef1 = playerY;
    const yRef2 = playerY - 100; // Look 100 pixels ahead to determine oncoming road direction
    const roadX1 = getRoadXAt(yRef1, distanceRef.current) + ROAD_WIDTH / 2;
    const roadX2 = getRoadXAt(yRef2, distanceRef.current) + ROAD_WIDTH / 2;
    
    const dx = roadX2 - roadX1;
    const dy = yRef2 - yRef1; // -100
    
    // Calculate the angle of the road relative to the vertical up-direction
    const roadAngle = Math.atan2(dx, -dy);
    
    // Determine the road deviation from the center of the viewport
    const roadCenter_player = roadX1;
    const roadDeviation = roadCenter_player - CANVAS_WIDTH / 2;
    
    // Target camera values to keep road upright and centered under the player
    const targetCameraAngle = -roadAngle * 1.3;
    const targetCameraSlide = -roadDeviation;
    
    // Smooth interpolation for camera follow movement and alignment
    const lerpFactor = 0.12; // Increased responsiveness
    cameraAngleRef.current += (targetCameraAngle - cameraAngleRef.current) * lerpFactor;
    cameraSlideRef.current += (targetCameraSlide - cameraSlideRef.current) * lerpFactor;

    draw();
    requestRef.current = requestAnimationFrame(update);
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const CANVAS_WIDTH = displayWidthRef.current;
    const CANVAS_HEIGHT = displayHeightRef.current;

    // Hard reset canvas backing store to original retro dimensions to restore original zoom and pixel ratio
    if (canvas.width !== CANVAS_WIDTH || canvas.height !== CANVAS_HEIGHT) {
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
    }

    // Draw base solid color for sky/ground back-surface
    ctx.fillStyle = '#033b2c'; 
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Apply 2.5D camera rotation, sliding, and speed-induced rumble vibrations around the player region
    ctx.save();
    const pivotX = CANVAS_WIDTH / 2;
    const pivotY = CANVAS_HEIGHT + 50;
    
    // Constant 0 values to keep the screen perfectly stabilized as requested, preventing any camera vibration/shake
    const shakeX = 0;
    const shakeY = 0;
    
    ctx.translate(pivotX + cameraSlideRef.current + shakeX, pivotY + shakeY);
    ctx.rotate(cameraAngleRef.current);
    ctx.translate(-pivotX, -pivotY);

    // Configurable flat scale for a perfectly zoomed-out bird's-eye (cenital) view
    const TOP_DOWN_SCALE = 0.52;

    // Draw Road & Ground in segments to create the flat top-down scrolling effect
    const segmentHeight = 5;
    for (let y = 0; y < CANVAS_HEIGHT; y += segmentHeight) {
      const roadX_native = getRoadXAt(y, distanceRef.current);
      const roadCenter = roadX_native + ROAD_WIDTH / 2;
      
      const wScale = TOP_DOWN_SCALE;
      
      const currentRoadWidth = ROAD_WIDTH * wScale;
      const roadX_draw = roadCenter - currentRoadWidth / 2;
      
      // Traditional 2D overhead grass striping based on scrolling distance!
      const grassStripeY = y - distanceRef.current * 125; 
      const isAltGrass = Math.floor(grassStripeY / 35) % 2 === 0;
      
      // Draw alternating grass field segment
      ctx.fillStyle = isAltGrass ? '#064e3b' : '#032c21'; // High contrast rich forest green toggles
      ctx.fillRect(0, y, CANVAS_WIDTH, segmentHeight);
      
      // Draw Stairs and Audience on the sides (scaled perfectly to match the 2D roads)
      const stairWidth = 10;
      const stairOffset = 15;
      
      const currentStairWidth = stairWidth * wScale;
      const currentStairOffset = stairOffset * wScale;
      
      const leftStairX = roadX_draw - currentStairOffset - currentStairWidth;
      const rightStairX = roadX_draw + currentRoadWidth + currentStairOffset;
      
      // Left Stairs
      ctx.fillStyle = '#4b5563'; // Concrete color
      ctx.fillRect(leftStairX, y, currentStairWidth, segmentHeight);
      // Right Stairs
      ctx.fillRect(rightStairX, y, currentStairWidth, segmentHeight);
      
      // Audience (Small colorful dots, perfectly aligned and scaled with the stairs)
      if (Math.floor((y - distanceRef.current * 100) / 20) % 2 === 0) {
        const colors = ['#ef4444', '#3b82f6', '#facc15', '#fff', '#22c55e'];
        for (let i = 0; i < 2; i++) {
          const audienceDotRadius = Math.max(0.6, 2 * wScale);
          const audienceSpacing = 5 * wScale;
          const leftAudienceX = leftStairX + (2 * wScale) + i * audienceSpacing;
          const rightAudienceX = rightStairX + (2 * wScale) + i * audienceSpacing;
          
          // Left audience
          ctx.beginPath();
          ctx.arc(leftAudienceX, y + segmentHeight / 2, audienceDotRadius, 0, Math.PI * 2);
          ctx.fill();
          // Right audience
          ctx.beginPath();
          ctx.arc(rightAudienceX, y + segmentHeight / 2, audienceDotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Simple House Block
      if (Math.floor((y - distanceRef.current * 80) / 150) % 3 === 0) {
        const houseWidth = 40 * wScale;
        const houseHeight = 35 * wScale;
        const leftHouseX = leftStairX - houseWidth - 10 * wScale;
        const rightHouseX = rightStairX + currentStairWidth + 10 * wScale;
        
        ctx.fillStyle = '#78350f'; // Brown color for houses
        ctx.fillRect(leftHouseX, y - houseHeight, houseWidth, houseHeight);
        ctx.fillRect(rightHouseX, y - houseHeight, houseWidth, houseHeight);
        
        // Roof
        ctx.fillStyle = '#991b1b';
        ctx.beginPath();
        ctx.moveTo(leftHouseX, y - houseHeight);
        ctx.lineTo(leftHouseX + houseWidth / 2, y - houseHeight - 15 * wScale);
        ctx.lineTo(leftHouseX + houseWidth, y - houseHeight);
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(rightHouseX, y - houseHeight);
        ctx.lineTo(rightHouseX + houseWidth / 2, y - houseHeight - 15 * wScale);
        ctx.lineTo(rightHouseX + houseWidth, y - houseHeight);
        ctx.fill();
      }

      // Road Surface
      ctx.fillStyle = '#1f2937'; 
      ctx.fillRect(roadX_draw, y, currentRoadWidth, segmentHeight);

      // Curbs (Beautifully aligned and scaled with road width)
      const curbWidth = 15;
      const currentCurbWidth = curbWidth * wScale;
      const stripeHeight = 40;
      const isRed = Math.floor((y - distanceRef.current * 100) / stripeHeight) % 2 === 0;
      ctx.fillStyle = isRed ? '#ef4444' : '#fff';
      ctx.fillRect(roadX_draw - currentCurbWidth, y, currentCurbWidth, segmentHeight);
      ctx.fillRect(roadX_draw + currentRoadWidth, y, currentCurbWidth, segmentHeight);

      // Center Line
      if (Math.floor((y - distanceRef.current * 100) / 30) % 2 === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(roadCenter - wScale, y, Math.max(1, 2 * wScale), segmentHeight);
      }
    }

    // Start Line (Checkered) - Ensure visibility at the beginning
    const startLineY = (gameState === 'start' || gameState === 'countdown')
      ? (CANVAS_HEIGHT - 150)
      : (CANVAS_HEIGHT - 150) + (distanceRef.current * 100);

    if (startLineY < CANVAS_HEIGHT + 100 && startLineY > -100) {
      const squareSize = 20;
      for (let yOffset = 0; yOffset < 40; yOffset += segmentHeight) {
        const currentY = startLineY + yOffset;
        if (currentY >= 0 && currentY < CANVAS_HEIGHT) { // safe boundaries
          const roadX_native = getRoadXAt(currentY, distanceRef.current);
          const roadCenter = roadX_native + ROAD_WIDTH / 2;
          const wScale = TOP_DOWN_SCALE;
          const currentRoadWidth = ROAD_WIDTH * wScale;
          const roadX_draw = roadCenter - currentRoadWidth / 2;
          
          const currentSquareSize = squareSize * wScale;
          for (let x = 0; x < currentRoadWidth; x += currentSquareSize) {
            ctx.fillStyle = (Math.floor(x / currentSquareSize) + Math.floor(yOffset / squareSize)) % 2 === 0 ? '#fff' : '#000';
            ctx.fillRect(roadX_draw + x, currentY, currentSquareSize, segmentHeight);
          }
        }
      }
    }

    // Countdown Display
    if (gameState === 'countdown') {
      ctx.save();
      ctx.font = 'bold 80px sans-serif';
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (countdown > 0) {
        ctx.fillText(countdown.toString(), CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      } else {
        ctx.fillText('GO!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      }
      ctx.restore();
    }

    // Draw Entities (scaled for flat overhead top-down presentation)
    entities.current.forEach(entity => {
      const entY = entity.y;
      if (entY < -50 || entY > CANVAS_HEIGHT + 100) return;

      const roadX_native_ent = getRoadXAt(entY, distanceRef.current);
      const roadCenter_ent = roadX_native_ent + ROAD_WIDTH / 2;
      const wScale_ent = TOP_DOWN_SCALE;
      
      const currentRoadWidth_ent = ROAD_WIDTH * wScale_ent;
      const scaledOffset = (entity.laneOffset - ROAD_WIDTH / 2) * wScale_ent;
      const drawX = roadCenter_ent + scaledOffset;
      
      const drawWidth = CAR_WIDTH * wScale_ent;
      const drawHeight = CAR_HEIGHT * wScale_ent;

      if (entity.type === 'pothole') {
        ctx.fillStyle = '#166534'; // Dark green leaves
        ctx.beginPath();
        ctx.ellipse(drawX + drawWidth / 2, entY + drawHeight / 2, 35 * wScale_ent, 25 * wScale_ent, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#451a03';
        ctx.beginPath();
        ctx.arc(drawX + drawWidth / 2, entY + drawHeight / 2, 10 * wScale_ent, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#15803d';
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.ellipse(drawX + 10 * wScale_ent + i * 8 * wScale_ent, entY + 10 * wScale_ent + (i % 2) * 15 * wScale_ent, 12 * wScale_ent, 8 * wScale_ent, i, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }

      if (entity.type === 'oil') {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.beginPath();
        ctx.ellipse(drawX + drawWidth / 2, entY + drawHeight / 2, 40 * wScale_ent, 20 * wScale_ent, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.ellipse(drawX + drawWidth / 2 - 10 * wScale_ent, entY + drawHeight / 2 - 5 * wScale_ent, 15 * wScale_ent, 5 * wScale_ent, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      if (entity.type === 'marker') {
        ctx.fillStyle = '#9ca3af';
        ctx.fillRect(drawX - 2 * wScale_ent, entY + 12 * wScale_ent, 4 * wScale_ent, 25 * wScale_ent);

        ctx.fillStyle = '#ef4444'; // Red border
        ctx.beginPath();
        ctx.arc(drawX, entY, 14 * wScale_ent, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#fff'; // White center
        ctx.beginPath();
        ctx.arc(drawX, entY, 11 * wScale_ent, 0, Math.PI * 2);
        ctx.fill();

        const markerFontSize = Math.max(6, Math.floor(11 * wScale_ent));
        ctx.font = `bold ${markerFontSize}px sans-serif`;
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.fillText(`${entity.markerValue}km`, drawX, entY + 4 * wScale_ent);
        ctx.textAlign = 'left'; // Reset
        return;
      }

      ctx.save();
      ctx.translate(drawX + drawWidth / 2, entY + drawHeight / 2);
      ctx.rotate(entity.angle);
      
      ctx.fillStyle = entity.color;
      ctx.fillRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-drawWidth / 2 + 4 * wScale_ent, -drawHeight / 2 + 8 * wScale_ent, drawWidth - 8 * wScale_ent, 12 * wScale_ent); 
      
      if (entity.type === 'rival' || entity.type === 'enemy') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(-drawWidth / 2 + 2 * wScale_ent, -drawHeight / 2 + 2 * wScale_ent, 6 * wScale_ent, 4 * wScale_ent); 
        ctx.fillRect(drawWidth / 2 - 8 * wScale_ent, -drawHeight / 2 + 2 * wScale_ent, 6 * wScale_ent, 4 * wScale_ent);
      }
      
      if (entity.type === 'rival') {
        ctx.fillStyle = entity.color;
        ctx.fillRect(-drawWidth / 2 - 2 * wScale_ent, drawHeight / 2 - 5 * wScale_ent, drawWidth + 4 * wScale_ent, 8 * wScale_ent);
      }
      
      ctx.restore();
    });

    // Draw Drift Particles
    particlesRef.current.forEach(p => {
      const partY = p.y;
      if (partY < -50 || partY > CANVAS_HEIGHT + 100) return;

      const roadX_native_part = getRoadXAt(partY, distanceRef.current);
      const roadCenter_part = roadX_native_part + ROAD_WIDTH / 2;
      const wScale_part = TOP_DOWN_SCALE;

      // Convert particle x coordinates using standard offset mapping:
      const partOffset_unscaled = p.x - roadX_native_part;
      const partScaledOffset = (partOffset_unscaled - ROAD_WIDTH / 2) * wScale_part;
      const partDrawX = roadCenter_part + partScaledOffset;
      const partDrawSize = p.size * wScale_part;

      ctx.save();
      ctx.beginPath();
      if (p.isSpark) {
        ctx.fillStyle = `rgba(${p.color === '250, 204, 21' ? '250, 204, 21' : '239, 68, 68'}, ${p.alpha})`;
        ctx.arc(partDrawX, partY, partDrawSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
        ctx.arc(partDrawX, partY, partDrawSize * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.arc(partDrawX, partY, partDrawSize, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // Draw Player
    const playerY = playerPos.current.y;
    const roadX_native_play = getRoadXAt(playerY, distanceRef.current);
    const roadCenter_play = roadX_native_play + ROAD_WIDTH / 2;
    const wScale_play = TOP_DOWN_SCALE;
    
    // Calculate player horizontal offset in unscaled road space (0 = left, ROAD_WIDTH = right)
    const playerOffset_unscaled = playerPos.current.x - roadX_native_play;
    // Map to scaled road center offset
    const playerScaledOffset = (playerOffset_unscaled - (ROAD_WIDTH - CAR_WIDTH) / 2) * wScale_play;
    const playerDrawX = roadCenter_play + playerScaledOffset - (CAR_WIDTH * wScale_play) / 2;
    
    const playerDrawWidth = CAR_WIDTH * wScale_play;
    const playerDrawHeight = CAR_HEIGHT * wScale_play;

    ctx.save();
    ctx.translate(playerDrawX + playerDrawWidth / 2, playerY + playerDrawHeight / 2);
    ctx.rotate(playerAngle.current + driftAngleRef.current);

    ctx.fillStyle = '#3b82f6'; 
    ctx.fillRect(-playerDrawWidth / 2, -playerDrawHeight / 2, playerDrawWidth, playerDrawHeight);
    
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(-playerDrawWidth / 2 - 2 * wScale_play, playerDrawHeight / 2 - 5 * wScale_play, playerDrawWidth + 4 * wScale_play, 8 * wScale_play);
    
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(-playerDrawWidth / 2 + 4 * wScale_play, -playerDrawHeight / 2 + 8 * wScale_play, playerDrawWidth - 8 * wScale_play, 12 * wScale_play);
    
    ctx.fillStyle = '#fff';
    ctx.fillRect(-playerDrawWidth / 2 + 2 * wScale_play, -playerDrawHeight / 2 + 2 * wScale_play, 6 * wScale_play, 4 * wScale_play);
    ctx.fillRect(playerDrawWidth / 2 - 8 * wScale_play, -playerDrawHeight / 2 + 2 * wScale_play, 6 * wScale_play, 4 * wScale_play);
    
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-playerDrawWidth / 2 + 2 * wScale_play, playerDrawHeight / 2 - 2 * wScale_play, 6 * wScale_play, 4 * wScale_play);
    ctx.fillRect(playerDrawWidth / 2 - 8 * wScale_play, playerDrawHeight / 2 - 2 * wScale_play, 6 * wScale_play, 4 * wScale_play);
    
    ctx.restore();

    // Floating text feedback for active drifting or score gains
    if (isDriftingRef.current && driftScoreRef.current > 10) {
      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#22d3ee';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = '#22d3ee'; // Electric cyan
      ctx.textAlign = 'center';
      ctx.fillText(`DRIFT ${driftScoreRef.current} PTS`, playerDrawX + playerDrawWidth / 2, playerY - 24);
      
      ctx.shadowBlur = 4;
      ctx.shadowColor = '#facc15';
      ctx.fillStyle = '#facc15'; // Hot yellow multiplier
      ctx.font = 'bold 9px monospace';
      ctx.fillText(`⚡ MULTIPLIER x${Math.min(5, 1 + Math.floor(driftComboRef.current / 30))}`, playerDrawX + playerDrawWidth / 2, playerY - 12);
      ctx.restore();
    } else if (uiShowDriftPayout > 0 && uiShowDriftMsg) {
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#facc15'; // Golden payout glow
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#facc15';
      ctx.textAlign = 'center';
      
      const textToDisplay = uiShowDriftMsg.includes('CHOQUE') ? `PUNTOS +${uiShowDriftPayout}` : `DRIFT +${uiShowDriftPayout} PTS`;
      ctx.fillText(textToDisplay, playerDrawX + playerDrawWidth / 2, playerY - 25);
      
      ctx.shadowBlur = 0;
      ctx.fillStyle = uiShowDriftMsg.includes('CHOQUE') ? '#ef4444' : '#67e8f9';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(uiShowDriftMsg, playerDrawX + playerDrawWidth / 2, playerY - 13);
      ctx.restore();
    }

    ctx.restore(); // Restore camera rotation and slide visual transformation
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(update);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState]);

  useEffect(() => {
    if (uiScore > highScore) setHighScore(uiScore);
  }, [uiScore, highScore]);

  return (
    <div className="w-screen h-screen bg-neutral-950 text-white flex flex-col overflow-hidden font-sans select-none p-0">
      
      {/* Centered clean game layout structure, removing the phone frame mockup */}
      <div className="w-full h-full relative bg-neutral-950 flex flex-col overflow-hidden outline-none">

        {/* Game Canvas Container - Fullscreen */}
        <div 
          ref={containerRef}
          tabIndex={0}
          className="relative w-full h-full bg-neutral-950 focus:outline-none transition-all flex items-center justify-center overflow-hidden"
          onMouseDown={() => containerRef.current?.focus()}
        >
          <canvas
            ref={canvasRef}
            width={canvasRect.width}
            height={canvasRect.height}
            className="w-full h-full block"
          />

          {/* Top Arcade HUD & Dashboard Instrumentation */}
          {(gameState === 'playing' || gameState === 'countdown') && (
            <div className="absolute top-3 inset-x-3 sm:inset-x-6 z-10 pointer-events-none select-none flex flex-col gap-2">
              {/* Glassmorphic digital instruments dashboard ribbon */}
              <div className="w-full max-w-2xl mx-auto flex items-center justify-between bg-neutral-900/40 backdrop-blur-lg px-4 py-2 rounded-2xl border border-neutral-700/50 shadow-xl pointer-events-auto">
                
                {/* 1. DIGITAL SPEEDOMETER (Left Instrument Panel) */}
                <div className="flex flex-col">
                  <span className="text-[7px] font-black uppercase tracking-widest text-neutral-500 leading-none">VELOCIDAD</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-2xl font-black italic tracking-tight tabular-nums text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]">
                      {Math.max(0, Math.floor(uiSpeed * 10))}
                    </span>
                    <span className="text-[8px] font-black italic text-neutral-400">KM/H</span>
                  </div>
                  {/* SPEED DIAL GRAPHIC */}
                  <div className="w-[75px] h-1 bg-neutral-900 rounded-full mt-1 overflow-hidden flex">
                    <div 
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-100"
                      style={{ width: `${(uiSpeed / MAX_SPEED) * 100}%` }}
                    />
                  </div>
                </div>

                {/* 2. CHARRING PROGRESS & CURVATURE RADAR (Center Instrument) */}
                <div className="flex flex-col items-center text-center">
                  <span className="text-[7px] font-black uppercase tracking-widest text-neutral-500 leading-none">PUNTOS</span>
                  <span className="text-xl font-extrabold italic text-amber-400 tabular-nums leading-none mt-1 drop-shadow-[0_0_10px_rgba(245,158,11,0.3)]">
                    {uiScore}
                  </span>
                  <span className="text-[6px] font-black tracking-wider text-neutral-400 leading-none mt-1 uppercase">
                    RÉCORD: {highScore > 0 ? highScore : 'NO RECORD'}
                  </span>
                </div>

                {/* 3. BATTERY POWER / ENERGY BAR (Right Instrument Panel) */}
                <div className="flex flex-col items-end">
                  <span className="text-[7px] font-black uppercase tracking-widest text-neutral-500 leading-none">BATERÍA / ENERGÍA</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Fuel className={`w-3.5 h-3.5 ${uiFuel <= 30 ? 'text-red-500 animate-bounce' : 'text-emerald-400'}`} />
                    <span className={`text-xl font-black italic tabular-nums ${uiFuel <= 30 ? 'text-red-400 leading-none animate-pulse' : 'text-emerald-400'}`}>
                      {Math.max(0, Math.floor(uiFuel))}%
                    </span>
                  </div>
                  {/* ENERGY BAR GRAPHIC */}
                  <div className="w-[85px] h-1.5 bg-neutral-900 rounded-full mt-1 overflow-hidden border border-neutral-800">
                    <div 
                      className={`h-full rounded-full transition-all duration-150 ${uiFuel <= 30 ? 'bg-gradient-to-r from-red-600 to-red-400 animate-pulse' : 'bg-gradient-to-r from-emerald-500 to-teal-400'}`}
                      style={{ width: `${uiFuel}%` }}
                    />
                  </div>
                </div>

              </div>

              {/* Race Distance/Track Progress Meter Ribbon */}
              <div className="w-full max-w-sm mx-auto bg-neutral-900/40 backdrop-blur-lg border border-neutral-700/50 rounded-full py-1.5 px-3.5 flex items-center justify-between gap-3 shadow-lg mt-1 select-none pointer-events-auto">
                <span className="text-[7.5px] font-black tracking-widest text-neutral-400 uppercase leading-none">PROGRESO</span>
                
                <div className="flex-1 h-2 bg-neutral-900 rounded-full relative overflow-hidden mx-1.5 border border-neutral-800/40">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 rounded-full transition-all duration-150"
                    style={{ width: `${Math.min(100, (uiDistance / TOTAL_RACE_DISTANCE) * 100)}%` }}
                  />
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-extrabold italic text-cyan-400 tabular-nums leading-none">
                    {Math.max(0, Math.floor(uiDistance / 100))}
                  </span>
                  <span className="text-[7px] font-black text-neutral-500">/</span>
                  <span className="text-[8px] font-black text-neutral-500 uppercase leading-none">30 KM</span>
                </div>
              </div>
            </div>
          )}

          {/* Floating Minimap Overlay (Visible on the right during active gameplay as requested) */}
          {(gameState === 'playing' || gameState === 'countdown') && (
            <div className="absolute right-3 top-[22%] sm:right-5 z-10 pointer-events-none select-none flex flex-col items-center gap-1.5 bg-neutral-900/40 backdrop-blur-lg px-2.5 py-3.5 rounded-2xl border border-neutral-700/50 shadow-xl pointer-events-auto w-[64px] sm:w-[72px]">
              <span className="text-[6.5px] font-black tracking-widest text-neutral-400 uppercase leading-none">QUEDA</span>
              <span className="text-[10px] font-black italic text-cyan-400 tabular-nums leading-none">
                {Math.max(0, Math.floor((TOTAL_RACE_DISTANCE - uiDistance) / 100))} KM
              </span>
              
              <div className="relative w-[34px] h-[120px] sm:h-[135px] mt-2 flex items-center justify-center">
                <svg width="34" height="120" viewBox="0 0 34 120" className="opacity-95">
                  <path
                    d={generateMinimapPath(34, 120)}
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.3)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                  <path
                    d={generateMinimapPath(34, 120)}
                    fill="none"
                    stroke="url(#minimap-neon-glow)"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                    strokeDasharray="140"
                    strokeDashoffset={140 - (uiDistance / TOTAL_RACE_DISTANCE) * 140}
                    className="opacity-90"
                    style={{ transition: 'stroke-dashoffset 0.5s linear' }}
                  />
                  <defs>
                    <linearGradient id="minimap-neon-glow" x1="0%" y1="100%" x2="0%" y2="0%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#22d3ee" />
                    </linearGradient>
                  </defs>
                </svg>
                {/* Finish label */}
                <span className="absolute top-[-15px] text-[10px] leading-none select-none animate-bounce">🏁</span>
                {/* Pulse dot representing the player car */}
                <div
                  className="absolute w-3.5 h-3.5 bg-cyan-400 rounded-full border-2 border-white shadow-[0_0_10px_rgba(34,211,238,0.9)] -translate-x-1/2 -translate-y-1/2 transition-all duration-75 flex items-center justify-center animate-pulse"
                  style={{
                    left: `${getPlayerMinimapCoords(34, 120).x}px`,
                    top: `${getPlayerMinimapCoords(34, 120).y}px`,
                  }}
                >
                  <div className="w-1.5 h-1.5 bg-white rounded-full" />
                </div>
              </div>
            </div>
          )}

          {/* Bottom Virtual Tactile Console Controls (Reintroduced for authentic gameplay controls) */}
          {(gameState === 'playing' || gameState === 'countdown') && (
            <div className="absolute bottom-5 inset-x-3 sm:inset-x-8 z-10 select-none flex flex-col items-center gap-2 pointer-events-none">
              
              {/* Keyboard hints banner */}
              <div className="px-2.5 py-0.5 bg-black/70 border border-neutral-800/60 rounded-full text-[8px] font-bold uppercase tracking-[0.2em] text-neutral-500 mb-1 pointer-events-auto">
                ⌨️ <span className="text-neutral-400">W-S-A-D / Arrows</span> to Drive • <span className="text-neutral-400">Spacebar</span> to Drift
              </div>

              {/* Main controls deck wrapper */}
              <div className="w-full max-w-xl mx-auto flex items-end justify-between px-2 sm:px-4 pointer-events-auto gap-4">
                
                {/* LEFT BLOCK: DIRECTION PAD (STEERING D-PAD) */}
                <div className="flex items-center gap-2.5">
                  {/* Left Steer Button */}
                  <button
                    onPointerDown={() => { keys.current['arrowleft'] = true; }}
                    onPointerUp={() => { keys.current['arrowleft'] = false; }}
                    onPointerLeave={() => { keys.current['arrowleft'] = false; }}
                    onTouchStart={(e) => { e.preventDefault(); keys.current['arrowleft'] = true; }}
                    onTouchEnd={(e) => { e.preventDefault(); keys.current['arrowleft'] = false; }}
                    className="w-14 h-14 sm:w-[54px] sm:h-[54px] rounded-2xl bg-black/85 border border-neutral-800 hover:border-neutral-500 text-neutral-300 active:text-cyan-400 active:border-cyan-500/80 active:shadow-[0_0_15px_rgba(34,211,238,0.3)] transition-all flex items-center justify-center active:scale-90 shadow-2xl shrink-0 cursor-pointer outline-none touch-none"
                    title="A / Flecha Izquierda"
                  >
                    <ChevronLeft className="w-8 h-8 pointer-events-none" strokeWidth={2.5} />
                  </button>

                  {/* Right Steer Button */}
                  <button
                    onPointerDown={() => { keys.current['arrowright'] = true; }}
                    onPointerUp={() => { keys.current['arrowright'] = false; }}
                    onPointerLeave={() => { keys.current['arrowright'] = false; }}
                    onTouchStart={(e) => { e.preventDefault(); keys.current['arrowright'] = true; }}
                    onTouchEnd={(e) => { e.preventDefault(); keys.current['arrowright'] = false; }}
                    className="w-14 h-14 sm:w-[54px] sm:h-[54px] rounded-2xl bg-black/85 border border-neutral-800 hover:border-neutral-500 text-neutral-300 active:text-cyan-400 active:border-cyan-500/80 active:shadow-[0_0_15px_rgba(34,211,238,0.3)] transition-all flex items-center justify-center active:scale-90 shadow-2xl shrink-0 cursor-pointer outline-none touch-none"
                    title="D / Flecha Derecha"
                  >
                    <ChevronRight className="w-8 h-8 pointer-events-none" strokeWidth={2.5} />
                  </button>
                </div>

                {/* CENTER BLOCK: CHROME NEON COCKPIT STEERING WHEEL */}
                <div className="hidden sm:flex flex-col items-center justify-center gap-1 min-w-[90px]">
                  <div 
                    className="w-[64px] h-[64px] rounded-full border-4 border-double border-neutral-800 bg-neutral-950/90 shadow-[inset_0_0_10px_rgba(255,255,255,0.05),0_0_15px_rgba(0,0,0,0.8)] flex items-center justify-center transition-all duration-75 relative animate-none"
                    style={{ transform: `rotate(${uiWheelAngle}deg)` }}
                  >
                    {/* Metallic Center Hub spokes */}
                    <div className="absolute top-1/2 left-0 right-0 h-1 bg-gradient-to-r from-neutral-700 via-neutral-300 to-neutral-700 -translate-y-1/2" />
                    <div className="absolute left-1/2 top-1/2 w-1 h-[28px] bg-gradient-to-b from-neutral-300 to-neutral-700 -translate-x-1/2" />
                    {/* Center Hubcap Logo */}
                    <div className="w-[18px] h-[18px] rounded-full bg-neutral-900 border-2 border-neutral-500 shadow-lg flex items-center justify-center z-10">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    </div>
                  </div>
                  <span className="text-[6px] font-black uppercase tracking-widest text-neutral-500 mt-1">VOLANTE</span>
                </div>

                {/* RIGHT BLOCK: ACELERADOR / PEDALES REALISTA */}
                <div className="flex items-end gap-3">
                  {/* BRAKE & DRIFT PEDAL */}
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[6px] font-black text-neutral-500 uppercase tracking-widest leading-none">FRENAR / DRIFT</span>
                    <button
                      onPointerDown={() => { keys.current['arrowdown'] = true; keys.current[' '] = true; }}
                      onPointerUp={() => { keys.current['arrowdown'] = false; keys.current[' '] = false; }}
                      onPointerLeave={() => { keys.current['arrowdown'] = false; keys.current[' '] = false; }}
                      onTouchStart={(e) => { e.preventDefault(); keys.current['arrowdown'] = true; keys.current[' '] = true; }}
                      onTouchEnd={(e) => { e.preventDefault(); keys.current['arrowdown'] = false; keys.current[' '] = false; }}
                      className="h-14 w-11 bg-neutral-900 border border-red-500/30 active:border-red-500 text-red-500 text-[8px] font-black tracking-tighter uppercase rounded-lg active:bg-red-950/40 active:shadow-[0_0_12px_rgba(239,68,68,0.25)] flex flex-col items-center justify-between py-2 transition-all active:scale-95 shadow-lg select-none outline-none touch-none cursor-pointer"
                      title="Barra Espaciadora / Frenar"
                    >
                      <div className="flex flex-col gap-0.5 w-full px-1 justify-center opacity-60">
                        <div className="h-[2px] bg-red-500/80 rounded" />
                        <div className="h-[2px] bg-red-500/80 rounded" />
                        <div className="h-[2px] bg-red-500/80 rounded" />
                      </div>
                      <span className="text-[7px] font-black leading-none italic uppercase">STOP</span>
                    </button>
                  </div>

                  {/* ACCELERATOR GAS PEDAL */}
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[6px] font-black text-neutral-500 uppercase tracking-widest leading-none">ACELERAR</span>
                    <button
                      onPointerDown={() => { keys.current['arrowup'] = true; }}
                      onPointerUp={() => { keys.current['arrowup'] = false; }}
                      onPointerLeave={() => { keys.current['arrowup'] = false; }}
                      onTouchStart={(e) => { e.preventDefault(); keys.current['arrowup'] = true; }}
                      onTouchEnd={(e) => { e.preventDefault(); keys.current['arrowup'] = false; }}
                      className="h-[68px] w-12 bg-neutral-900 border border-emerald-500/30 active:border-emerald-500 text-emerald-500 text-[8px] font-black tracking-tighter uppercase rounded-lg active:bg-emerald-950/40 active:shadow-[0_0_15px_rgba(16,185,129,0.3)] flex flex-col items-center justify-between py-2.5 transition-all active:scale-95 shadow-md shadow-emerald-950/20 select-none outline-none touch-none cursor-pointer"
                      title="W o Flecha Arriba"
                    >
                      <div className="flex flex-col gap-0.5 w-full px-1 justify-center opacity-60">
                        <div className="h-[2px] bg-emerald-500/80 rounded" />
                        <div className="h-[2px] bg-emerald-500/80 rounded" />
                        <div className="h-[2px] bg-emerald-500/80 rounded" />
                        <div className="h-[2px] bg-emerald-500/80 rounded" />
                      </div>
                      <div className="flex flex-col items-center gap-0.5 leading-none">
                        <ArrowUp className="w-3 h-3 animate-bounce leading-none" strokeWidth={3} />
                        <span className="text-[7px] font-black italic uppercase leading-none">GO!</span>
                      </div>
                    </button>
                  </div>
                </div>

              </div>

            </div>
          )}






          {/* Side Floating Drift/Multiplier Panel (Appears on the side during active drifting) */}
          <AnimatePresence>
            {uiIsDrifting && uiActiveDriftCombo > 0 && (
              <motion.div
                initial={{ opacity: 0, x: 50, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 50, scale: 0.9 }}
                className="absolute right-4 top-[35%] -translate-y-1/2 z-10 pointer-events-none select-none flex flex-col items-end gap-1"
              >
                <div className="bg-neutral-900/40 backdrop-blur-lg border border-amber-500/30 p-3 rounded-2xl shadow-[0_0_20px_rgba(245,158,11,0.2)] flex flex-col items-end min-w-[130px]">
                  <span className="text-[8px] font-black tracking-widest text-amber-500 uppercase flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> DERRAPANDO
                  </span>
                  
                  {/* Neon Multiplier */}
                  <span className="text-4xl font-extrabold italic text-amber-400 tabular-nums my-1 drop-shadow-[0_0_10px_rgba(245,158,11,0.5)] select-none">
                    x{Math.min(5, 1 + Math.floor(uiActiveDriftCombo / 30))}
                  </span>

                  {/* Drift Points */}
                  <span className="text-sm font-semibold text-neutral-300 tabular-nums">
                    +{uiActiveDriftScore} <span className="text-[10px] text-neutral-500 font-extrabold">PTS</span>
                  </span>

                  {/* Custom progress to next tier */}
                  <div className="w-full h-1 bg-neutral-900 rounded-full overflow-hidden mt-2">
                    <div 
                      className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-150"
                      style={{ width: `${Math.min(100, (uiActiveDriftCombo % 30) * 3.33)}%` }}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Overlays (Start, Gameover, Countdown) */}
          <AnimatePresence>
            {gameState === 'start' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center z-20"
              >
                <motion.div
                  initial={{ scale: 0.8, rotate: -5 }}
                  animate={{ scale: 1, rotate: 0 }}
                  className="mb-6"
                >
                  <div className="flex items-center justify-center gap-3 mb-2">
                    <Flag className="w-8 h-8 text-blue-500" />
                    <h1 className="text-4xl font-black italic tracking-tighter text-white drop-shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                      CIRCUIT FIGHTER
                    </h1>
                    <Flag className="w-8 h-8 text-blue-500 scale-x-[-1]" />
                  </div>
                  <div className="h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent mt-1" />
                </motion.div>

                <p className="text-neutral-400 mb-8 max-w-xs text-sm leading-relaxed font-semibold">
                  Professional racing circuit. Compete against rivals, manage energy, and master the curves.
                </p>

                <button
                  onClick={startGameSequence}
                  className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-500 transition-all rounded-xl font-black text-xl flex items-center gap-3 shadow-[0_0_40px_rgba(59,130,246,0.4)] active:scale-95"
                >
                  <Play className="w-6 h-6 fill-current" />
                  START RACE
                </button>

              </motion.div>
            )}

            {gameState === 'countdown' && (
              <motion.div
                key={countdown}
                initial={{ opacity: 0, scale: 3, rotate: 10 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.2 }}
                className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none"
              >
                <span className={`text-[10rem] font-black italic drop-shadow-[0_0_40px_rgba(255,255,255,0.6)] ${countdown === 0 ? 'text-green-500' : 'text-white'}`}>
                  {countdown > 0 ? countdown : 'GO!'}
                </span>
              </motion.div>
            )}

            {gameState === 'gameover' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 bg-neutral-950/95 flex flex-col items-center justify-center p-4 text-center z-20 overflow-y-auto"
              >
                {gameOverView === 'main' && (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.1, 1], rotate: [0, 5, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 3 }}
                    >
                      <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
                    </motion.div>
                    
                    <h2 className="text-4xl font-black mb-4 tracking-tighter italic text-red-500">RACE OVER</h2>
                    
                    <div className="grid grid-cols-2 gap-4 w-full max-w-xs mb-6">
                      <div className="bg-neutral-900 p-4 rounded-2xl border border-neutral-800">
                        <div className="text-neutral-500 text-[10px] font-black uppercase tracking-widest mb-1">Distance</div>
                        <div className="text-2xl font-black tabular-nums">{Math.floor(uiDistance)}<span className="text-sm ml-1">KM</span></div>
                      </div>
                      <div className="bg-neutral-900 p-4 rounded-2xl border border-neutral-800">
                        <div className="text-neutral-500 text-[10px] font-black uppercase tracking-widest mb-1">Points</div>
                        <div className="text-2xl font-black tabular-nums">{uiScore}</div>
                      </div>
                    </div>
                  </>
                )}

                {gameOverView === 'map' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-xs bg-neutral-900 p-5 rounded-2xl border border-neutral-800 mb-6"
                  >
                    <div className="flex items-center gap-2 mb-4 justify-center">
                      <MapIcon className="w-6 h-6 text-blue-500" />
                      <h3 className="text-xl font-black italic uppercase tracking-tighter text-blue-400">Circuito de Datos</h3>
                    </div>
                    <div className="aspect-video bg-neutral-950 rounded-xl border-2 border-neutral-800 relative overflow-hidden flex flex-col items-center justify-center p-3">
                      <div className="text-neutral-800 font-black text-4xl opacity-15 absolute">S-CURVE</div>
                      <p className="text-neutral-300 font-extrabold text-[11px] mb-2 z-10">LONGITUD: 30 KM</p>
                      <div className="flex flex-wrap gap-1.5 justify-center z-10">
                        <span className="px-1.5 py-0.5 bg-blue-500/10 rounded text-blue-400 text-[9px] font-black uppercase">CURVAS</span>
                        <span className="px-1.5 py-0.5 bg-amber-500/10 rounded text-amber-400 text-[9px] font-black uppercase">ACEITE</span>
                        <span className="px-1.5 py-0.5 bg-red-500/10 rounded text-red-500 text-[9px] font-black uppercase">BACHES</span>
                      </div>
                    </div>
                  </motion.div>
                )}

                {gameOverView === 'narrative' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-xs bg-neutral-900 p-5 rounded-2xl border border-neutral-800 mb-6 max-h-[220px] overflow-y-auto"
                  >
                    <div className="flex items-center gap-2 mb-3 justify-center">
                      <BookOpen className="w-6 h-6 text-amber-500" />
                      <h3 className="text-xl font-black italic uppercase tracking-tighter text-amber-400">Crónicas del Asfalto</h3>
                    </div>
                    <div className="text-left space-y-3 text-neutral-300 text-xs leading-relaxed font-semibold italic">
                      <p>
                        "En 2088, las megacorporaciones controlan la energía. Las pistas vacías son el único lugar para rebelarse."
                      </p>
                      <p>
                        "Los 'Circuit Fighters' desafían el monopolio recolectando combustible en carreras peligrosas por la libertad."
                      </p>
                    </div>
                  </motion.div>
                )}

                <div className="flex flex-col gap-2 w-full max-w-xs">
                  <button
                    onClick={startGameSequence}
                    className="w-full py-3 bg-white text-black hover:bg-neutral-200 transition-all rounded-xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 shadow-md"
                  >
                    <RotateCcw className="w-4 h-4" />
                    NUEVO JUEGO
                  </button>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setGameOverView(gameOverView === 'map' ? 'main' : 'map')}
                      className={`py-2.5 ${gameOverView === 'map' ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400'} hover:bg-blue-500 hover:text-white transition-all rounded-xl font-black text-xs flex items-center justify-center gap-2 active:scale-95`}
                    >
                      <MapIcon className="w-4 h-4" />
                      MAPA
                    </button>

                    <button
                      onClick={() => setGameOverView(gameOverView === 'narrative' ? 'main' : 'narrative')}
                      className={`py-2.5 ${gameOverView === 'narrative' ? 'bg-amber-600 text-white' : 'bg-neutral-800 text-neutral-400'} hover:bg-amber-500 hover:text-white transition-all rounded-xl font-black text-xs flex items-center justify-center gap-2 active:scale-95`}
                    >
                      <BookOpen className="w-4 h-4" />
                      NARRATIVA
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}
