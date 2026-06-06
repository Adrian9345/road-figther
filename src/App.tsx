/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Zap, Fuel, AlertTriangle, Play, RotateCcw, Flag, BookOpen, Map as MapIcon, ChevronLeft, ChevronRight, ArrowUp } from 'lucide-react';

// Constants
const ROAD_WIDTH = 340;
const CAR_WIDTH = 30;
const CAR_HEIGHT = 50;
const CANVAS_WIDTH = 390;
const CANVAS_HEIGHT = 500;
const INITIAL_FUEL = 100;
const FUEL_CONSUMPTION_RATE = 0.04;
const MAX_SPEED = 10; // 100 km/h
const MIN_SPEED = 3;  // 30 km/h
const ACCELERATION = 0.05;
const DECELERATION = 0.04;
const BRAKE_FORCE = 0.8;
const SIDE_SPEED = 1.2; // Increased for snappier, "shorter" response
const TOTAL_RACE_DISTANCE = 10000; // 100km (100 units = 1km)

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
  const [uiShowDriftPayout, setUiShowDriftPayout] = useState(0);
  const [uiShowDriftMsg, setUiShowDriftMsg] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(null);
  
  const speedRef = useRef(0);
  const sideVelocity = useRef(0);
  const fuelRef = useRef(INITIAL_FUEL);
  const distanceRef = useRef(0);
  const scoreRef = useRef(0);
  const playerPos = useRef({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT - 120 });
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
    const nextIndex = Math.min(index + 1, trackCurvature.current.length - 1);
    const t = (distance % segmentSize) / segmentSize;
    
    const c1 = trackCurvature.current[index] || 0;
    const c2 = trackCurvature.current[nextIndex] || 0;
    return c1 + (c2 - c1) * t;
  };

  // Helper to get road center at a specific Y coordinate with 2.5D visual curved projection
  const getRoadXAt = (y: number, distance: number) => {
    const baseOffset = (CANVAS_WIDTH - ROAD_WIDTH) / 2;
    
    // Smooth quadratic ease-in for visual projection perspective:
    const lookAheadFactor = (CANVAS_HEIGHT - y) / CANVAS_HEIGHT; // 0 (bottom) to 1 (top)
    const perspectiveFactor = Math.pow(lookAheadFactor, 1.8);
    
    // Look ahead on the track based on perspective height:
    const distAhead = perspectiveFactor * 250;
    
    const currentCurveVal = getRoadCurveAtDistance(distance);
    const targetCurveVal = getRoadCurveAtDistance(distance + distAhead);
    
    // Scale curve Offset to fit the 390px mobile view nicely
    const curveOffset = (targetCurveVal - currentCurveVal) * 0.15;
    
    return baseOffset + curveOffset;
  };

  const getRoadAngleAt = (y: number, distance: number) => {
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
    setUiActiveDriftScore(0);
    setUiShowDriftPayout(0);
    setUiShowDriftMsg('');

    // Generate Track Data: Extended circular S-shape
    const segmentSize = 100; // Smaller segments for smoother sine-based curves
    const totalSegments = Math.ceil(TOTAL_RACE_DISTANCE / segmentSize) + 10;
    trackCurvature.current = new Array(totalSegments).fill(0);
    
    // Use a long-period sine wave for circular, extended S-curves
    for (let i = 0; i < totalSegments; i++) {
      // Period of ~2000 units (20 segments) for wide curves
      trackCurvature.current[i] = Math.sin(i * 0.1) * 300;
    }
    
    // Extra smoothing for ultra-fluid circular motion
    for (let i = 5; i < totalSegments - 5; i++) {
      let sum = 0;
      for (let j = -5; j <= 5; j++) sum += trackCurvature.current[i + j];
      trackCurvature.current[i] = sum / 11;
    }
    
    // Setup Starting Grid: 4 rows of 2 cars (Columns)
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 2; col++) {
        const yOffset = CANVAS_HEIGHT - 300 - (row * 120);
        spawnEntity(true, yOffset, col);
      }
    }
    
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

  const update = (time: number) => {
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

      // Smooth steering with acceleration/friction
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

    setUiSpeed(speedRef.current);
    setUiFuel(fuelRef.current);
    setUiDistance(distanceRef.current);
    setUiScore(scoreRef.current);

    // Calculate 2.5D camera tilt turning & sliding (simulates camera banking and view rotation during curves)
    const curveVal = getRoadCurveAtDistance(distanceRef.current);
    const steeringFactor = isLeft ? -0.012 : (isRight ? 0.012 : 0);
    
    // Camera tilts opposite to the curve direction to simulate centrifugal banking or roll
    const targetCameraAngle = -(curveVal / 300) * 0.045 + steeringFactor;
    // Camera slides opposite to the curve direction to keep the visual perspective centered
    const targetCameraSlide = -(curveVal / 300) * 16;
    
    // Smooth interpolation
    const lerpFactor = 0.06;
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

    // Background (Static)
    ctx.fillStyle = '#064e3b'; 
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Apply 2.5D camera rotation and sliding visual effect around the player region
    ctx.save();
    const pivotX = CANVAS_WIDTH / 2;
    const pivotY = CANVAS_HEIGHT - 100;
    ctx.translate(pivotX + cameraSlideRef.current, pivotY);
    ctx.rotate(cameraAngleRef.current);
    ctx.translate(-pivotX, -pivotY);

    // Draw Road in segments to create the curve effect
    const segmentHeight = 5;
    for (let y = 0; y < CANVAS_HEIGHT; y += segmentHeight) {
      const roadX = getRoadXAt(y, distanceRef.current);
      
      // Draw Stairs and Audience on the sides (optimized for 390px mobile view)
      const stairWidth = 10;
      const stairOffset = 15;
      
      // Left Stairs
      ctx.fillStyle = '#4b5563'; // Concrete color
      ctx.fillRect(roadX - stairOffset - stairWidth, y, stairWidth, segmentHeight);
      // Right Stairs
      ctx.fillRect(roadX + ROAD_WIDTH + stairOffset, y, stairWidth, segmentHeight);
      
      // Audience (Small colorful dots)
      if (Math.floor((y - distanceRef.current * 100) / 20) % 2 === 0) {
        const colors = ['#ef4444', '#3b82f6', '#facc15', '#fff', '#22c55e'];
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = colors[(Math.floor(y / 10) + i) % colors.length];
          // Left audience
          ctx.beginPath();
          ctx.arc(roadX - stairOffset - stairWidth + 4 + i * 5, y + 2, 2, 0, Math.PI * 2);
          ctx.fill();
          // Right audience
          ctx.beginPath();
          ctx.arc(roadX + ROAD_WIDTH + stairOffset + 4 + i * 5, y + 2, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Road Surface
      ctx.fillStyle = '#1f2937'; 
      ctx.fillRect(roadX, y, ROAD_WIDTH, segmentHeight);

      // Curbs
      const curbWidth = 15;
      const stripeHeight = 40;
      const isRed = Math.floor((y - distanceRef.current * 100) / stripeHeight) % 2 === 0;
      ctx.fillStyle = isRed ? '#ef4444' : '#fff';
      ctx.fillRect(roadX - curbWidth, y, curbWidth, segmentHeight);
      ctx.fillRect(roadX + ROAD_WIDTH, y, curbWidth, segmentHeight);

      // Center Line
      if (Math.floor((y - distanceRef.current * 100) / 30) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(roadX + ROAD_WIDTH / 2 - 1, y, 2, segmentHeight);
      }
    }

    // Start Line (Checkered) - Only if visible
    const startLineY = (CANVAS_HEIGHT - 150) + (distanceRef.current * 100);
    if (startLineY < CANVAS_HEIGHT + 100 && startLineY > -100) {
      const squareSize = 20;
      for (let yOffset = 0; yOffset < 40; yOffset += segmentHeight) {
        const currentY = startLineY + yOffset;
        const roadX = getRoadXAt(currentY, distanceRef.current);
        for (let x = 0; x < ROAD_WIDTH; x += squareSize) {
          ctx.fillStyle = (Math.floor(x / squareSize) + Math.floor(yOffset / squareSize)) % 2 === 0 ? '#fff' : '#000';
          ctx.fillRect(roadX + x, currentY, squareSize, segmentHeight);
        }
      }
    }

    // Draw Entities
    entities.current.forEach(entity => {
      if (entity.type === 'pothole') {
        // Draw leaves covering a pothole
        ctx.fillStyle = '#166534'; // Dark green leaves
        ctx.beginPath();
        ctx.ellipse(entity.x + CAR_WIDTH / 2, entity.y + CAR_HEIGHT / 2, 35, 25, 0, 0, Math.PI * 2);
        ctx.fill();
        // Some brown spots for dirt/pothole underneath
        ctx.fillStyle = '#451a03';
        ctx.beginPath();
        ctx.arc(entity.x + CAR_WIDTH / 2, entity.y + CAR_HEIGHT / 2, 10, 0, Math.PI * 2);
        ctx.fill();
        // More leaves
        ctx.fillStyle = '#15803d';
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.ellipse(entity.x + 10 + i * 8, entity.y + 10 + (i % 2) * 15, 12, 8, i, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }

      if (entity.type === 'oil') {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.beginPath();
        ctx.ellipse(entity.x + CAR_WIDTH / 2, entity.y + CAR_HEIGHT / 2, 40, 20, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
        // Glossy effect
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.ellipse(entity.x + CAR_WIDTH / 2 - 10, entity.y + CAR_HEIGHT / 2 - 5, 15, 5, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      if (entity.type === 'marker') {
        // Sign post (Gray)
        ctx.fillStyle = '#9ca3af';
        ctx.fillRect(entity.x - 2, entity.y + 12, 4, 25);

        // Sign (White with Red border)
        ctx.fillStyle = '#ef4444'; // Red border
        ctx.beginPath();
        ctx.arc(entity.x, entity.y, 14, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#fff'; // White center
        ctx.beginPath();
        ctx.arc(entity.x, entity.y, 11, 0, Math.PI * 2);
        ctx.fill();

        // Text (Black)
        ctx.font = 'bold 11px sans-serif';
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.fillText(`${entity.markerValue}km`, entity.x, entity.y + 4);
        ctx.textAlign = 'left'; // Reset
        return;
      }

      ctx.save();
      ctx.translate(entity.x + CAR_WIDTH / 2, entity.y + CAR_HEIGHT / 2);
      ctx.rotate(entity.angle);
      
      // Draw Car Body
      ctx.fillStyle = entity.color;
      ctx.fillRect(-CAR_WIDTH / 2, -CAR_HEIGHT / 2, CAR_WIDTH, CAR_HEIGHT);
      
      // Windshield
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-CAR_WIDTH / 2 + 4, -CAR_HEIGHT / 2 + 8, CAR_WIDTH - 8, 12); 
      
      if (entity.type === 'rival' || entity.type === 'enemy') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(-CAR_WIDTH / 2 + 2, -CAR_HEIGHT / 2 + 2, 6, 4); 
        ctx.fillRect(CAR_WIDTH / 2 - 8, -CAR_HEIGHT / 2 + 2, 6, 4);
      }
      
      if (entity.type === 'rival') {
        ctx.fillStyle = entity.color;
        ctx.fillRect(-CAR_WIDTH / 2 - 2, CAR_HEIGHT / 2 - 5, CAR_WIDTH + 4, 8);
      }
      
      ctx.restore();
    });

    // Draw Drift Particles
    particlesRef.current.forEach(p => {
      ctx.save();
      ctx.beginPath();
      if (p.isSpark) {
        // Sparks
        ctx.fillStyle = `rgba(${p.color === '250, 204, 21' ? '250, 204, 21' : '239, 68, 68'}, ${p.alpha})`;
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Bright flare core
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
        ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Smoke clouds
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // Draw Player
    ctx.save();
    ctx.translate(playerPos.current.x + CAR_WIDTH / 2, playerPos.current.y + CAR_HEIGHT / 2);
    ctx.rotate(playerAngle.current + driftAngleRef.current);

    ctx.fillStyle = '#3b82f6'; 
    ctx.fillRect(-CAR_WIDTH / 2, -CAR_HEIGHT / 2, CAR_WIDTH, CAR_HEIGHT);
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(-CAR_WIDTH / 2 - 2, CAR_HEIGHT / 2 - 5, CAR_WIDTH + 4, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(-CAR_WIDTH / 2 + 4, -CAR_HEIGHT / 2 + 8, CAR_WIDTH - 8, 12);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-CAR_WIDTH / 2 + 2, -CAR_HEIGHT / 2 + 2, 6, 4);
    ctx.fillRect(CAR_WIDTH / 2 - 8, -CAR_HEIGHT / 2 + 2, 6, 4);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-CAR_WIDTH / 2 + 2, CAR_HEIGHT / 2 - 2, 6, 4);
    ctx.fillRect(CAR_WIDTH / 2 - 8, CAR_HEIGHT / 2 - 2, 6, 4);
    
    ctx.restore();

    // Floating text feedback for active drifting or score gains
    if (isDriftingRef.current && driftScoreRef.current > 10) {
      ctx.save();
      // Glowing text drop shadows
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#22d3ee';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = '#22d3ee'; // Electric cyan
      ctx.textAlign = 'center';
      ctx.fillText(`DRIFT ${driftScoreRef.current} PTS`, playerPos.current.x + CAR_WIDTH / 2, playerPos.current.y - 24);
      
      ctx.shadowBlur = 4;
      ctx.shadowColor = '#facc15';
      ctx.fillStyle = '#facc15'; // Hot yellow multiplier
      ctx.font = 'bold 9px monospace';
      ctx.fillText(`⚡ MULTIPLIER x${Math.min(5, 1 + Math.floor(driftComboRef.current / 30))}`, playerPos.current.x + CAR_WIDTH / 2, playerPos.current.y - 12);
      ctx.restore();
    } else if (uiShowDriftPayout > 0 && uiShowDriftMsg) {
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#facc15'; // Golden payout glow
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#facc15';
      ctx.textAlign = 'center';
      
      const textToDisplay = uiShowDriftMsg.includes('CHOQUE') ? `PUNTOS +${uiShowDriftPayout}` : `DRIFT +${uiShowDriftPayout} PTS`;
      ctx.fillText(textToDisplay, playerPos.current.x + CAR_WIDTH / 2, playerPos.current.y - 25);
      
      ctx.shadowBlur = 0;
      ctx.fillStyle = uiShowDriftMsg.includes('CHOQUE') ? '#ef4444' : '#67e8f9';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(uiShowDriftMsg, playerPos.current.x + CAR_WIDTH / 2, playerPos.current.y - 13);
      ctx.restore();
    }

    ctx.restore(); // Restore camera rotation and slide visual transformation

    // Minimap (Optimized for 390px canvas)
    const mapWidth = 35;
    const mapHeight = 150;
    const mapX = CANVAS_WIDTH - 50;
    const mapY = 15;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.roundRect(mapX - 10, mapY - 10, mapWidth + 20, mapHeight + 20, 10);
    ctx.fill();

    // Static Track trajectory on minimap (Entire Race)
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    
    const totalPoints = 100;
    for (let i = 0; i <= totalPoints; i++) {
      const dist = (i / totalPoints) * TOTAL_RACE_DISTANCE;
      const curve = getRoadCurveAtDistance(dist);
      
      // Visual offset on map based on curve
      // Scale curve to fit map width
      const relativeX = curve / 400; 
      const drawX = mapX + mapWidth / 2 + relativeX * (mapWidth / 2 - 5);
      const drawY = mapY + mapHeight - (i / totalPoints) * mapHeight;
      
      if (i === 0) ctx.moveTo(drawX, drawY);
      else ctx.lineTo(drawX, drawY);
    }
    ctx.stroke();

    // Draw Finish Line on Minimap
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mapX, mapY);
    ctx.lineTo(mapX + mapWidth, mapY);
    ctx.stroke();

    // Player position on minimap
    const progress = Math.min(distanceRef.current / TOTAL_RACE_DISTANCE, 1);
    const playerMapY = mapY + mapHeight - (progress * mapHeight);
    
    // Player's current curve offset
    const currentCurve = getRoadCurveAtDistance(distanceRef.current);
    const pRelativeX = currentCurve / 400;
    const pDrawX = mapX + mapWidth / 2 + pRelativeX * (mapWidth / 2 - 5);

    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(pDrawX, playerMapY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Finish flag on minimap
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.fillText('🏁', mapX + mapWidth / 2 - 8, mapY - 5);
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

        {/* Game Canvas Container */}
        <div 
          ref={containerRef}
          tabIndex={0}
          className="relative flex-1 w-full bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all flex items-center justify-center overflow-hidden"
          onMouseDown={() => containerRef.current?.focus()}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="max-h-full max-w-full aspect-[390/500] object-contain block"
          />

          {/* Overlays */}
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

                <div className="mt-10 flex gap-8 text-neutral-500 font-bold uppercase tracking-[0.2em] text-[9px]">
                  <div className="flex flex-col items-center gap-2">
                    <span className="px-2 py-1 bg-neutral-800 rounded-md border border-neutral-700 font-mono text-xs text-neutral-300">W</span>
                    <span>Throttle</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex gap-1.5">
                      <span className="px-2 py-1 bg-neutral-800 rounded-md border border-neutral-700 font-mono text-xs text-neutral-300">A</span>
                      <span className="px-2 py-1 bg-neutral-800 rounded-md border border-neutral-700 font-mono text-xs text-neutral-300">D</span>
                    </div>
                    <span>Steering</span>
                  </div>
                </div>
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
                      <p className="text-neutral-300 font-extrabold text-[11px] mb-2 z-10">LONGITUD: 100 KM</p>
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

        {/* Dashboard and Virtual Controllers Area below Canvas */}
        <div className="h-[270px] sm:h-[295px] shrink-0 bg-neutral-900 border-t-2 border-neutral-800 flex flex-col p-4 justify-between relative overflow-hidden">
          
          {/* Carbon Fiber Background Effect */}
          <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

          {/* Telemetry/HUD Row */}
          <div className="grid grid-cols-2 gap-3 relative z-10">
            {/* Speedometer */}
            <div className="bg-neutral-950 p-2.5 rounded-2xl border border-neutral-800 flex flex-col justify-between">
              <span className="text-[9px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> Telemetry
              </span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-black tabular-nums tracking-tight italic text-neutral-100">
                  {Math.floor(uiSpeed * 10)}
                </span>
                <span className="text-[10px] font-bold text-neutral-600 italic">KM/H</span>
              </div>
              <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden mt-1.5 p-[1px]">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-75"
                  style={{ width: `${(uiSpeed / MAX_SPEED) * 100}%` }}
                />
              </div>
            </div>

            {/* Energy (Fuel) Gauge */}
            <div className="bg-neutral-950 p-2.5 rounded-2xl border border-neutral-800 flex flex-col justify-between">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-1">
                  <Fuel className="w-3 h-3 text-emerald-500" /> Energy
                </span>
                <span className={`text-[10px] font-black ${uiFuel < 25 ? 'text-red-500 animate-pulse' : 'text-emerald-500'}`}>
                  {Math.floor(uiFuel)}%
                </span>
              </div>
              <div className="grid grid-cols-10 gap-0.5 h-4 mt-2">
                {[...Array(10)].map((_, i) => (
                  <div
                    key={i}
                    className={`h-full rounded-sm ${i < uiFuel / 10 ? (uiFuel < 25 ? 'bg-red-500' : 'bg-emerald-500') : 'bg-neutral-900'}`}
                    style={{ opacity: i < uiFuel / 10 ? 1 : 0.2 }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Virtual Steering and Pedals Pad Deck */}
          <div className="flex items-center justify-between mt-3 relative z-10 gap-2">
            
            {/* Steering Left/Right Buttons */}
            <div className="flex items-center gap-2">
              <button
                className="w-14 h-14 rounded-full bg-neutral-950 active:bg-blue-600 focus:outline-none border-2 border-neutral-800 flex items-center justify-center select-none cursor-pointer shadow-md active:scale-90 transition-transform active:border-blue-400 text-neutral-400 active:text-white"
                onMouseDown={() => { keys.current['arrowleft'] = true; }}
                onMouseUp={() => { keys.current['arrowleft'] = false; }}
                onMouseLeave={() => { keys.current['arrowleft'] = false; }}
                onTouchStart={(e) => { e.preventDefault(); keys.current['arrowleft'] = true; }}
                onTouchEnd={(e) => { e.preventDefault(); keys.current['arrowleft'] = false; }}
              >
                <ChevronLeft className="w-7 h-7" />
              </button>

              <button
                className="w-14 h-14 rounded-full bg-neutral-950 active:bg-blue-600 focus:outline-none border-2 border-neutral-800 flex items-center justify-center select-none cursor-pointer shadow-md active:scale-90 transition-transform active:border-blue-400 text-neutral-400 active:text-white"
                onMouseDown={() => { keys.current['arrowright'] = true; }}
                onMouseUp={() => { keys.current['arrowright'] = false; }}
                onMouseLeave={() => { keys.current['arrowright'] = false; }}
                onTouchStart={(e) => { e.preventDefault(); keys.current['arrowright'] = true; }}
                onTouchEnd={(e) => { e.preventDefault(); keys.current['arrowright'] = false; }}
              >
                <ChevronRight className="w-7 h-7" />
              </button>
            </div>

            {/* Mid Stats Screen */}
            <div className="flex-1 flex flex-col items-center justify-center text-center px-1">
              <div className="bg-neutral-950 py-1.5 px-3 rounded-xl border border-neutral-800 w-full flex flex-col gap-0.5">
                <div className="flex justify-between items-center text-[9px] font-black text-neutral-500 uppercase">
                  <span>Score</span>
                  <span className="text-neutral-300 tabular-nums font-bold">{uiScore}</span>
                </div>
                <div className="h-[1px] bg-neutral-900 w-full" />
                <div className="flex justify-between items-center text-[9px] font-black text-neutral-500 uppercase">
                  <span>Dist</span>
                  <span className="text-neutral-300 tabular-nums font-bold">{Math.floor(uiDistance)}KM</span>
                </div>
              </div>
            </div>

            {/* Accel & Brake Pedals Grid */}
            <div className="flex items-end gap-2 shrink-0">
              {/* Brake Pedal (Short, Red) */}
              <button
                className="w-14 h-16 rounded-xl bg-gradient-to-b from-rose-600 to-rose-800 active:from-rose-500 active:to-rose-700 border-2 border-rose-500/40 flex flex-col items-center justify-center select-none cursor-pointer shadow-md active:scale-95 transition-transform text-white"
                onMouseDown={() => { keys.current['arrowdown'] = true; keys.current[' '] = true; }}
                onMouseUp={() => { keys.current['arrowdown'] = false; keys.current[' '] = false; }}
                onMouseLeave={() => { keys.current['arrowdown'] = false; keys.current[' '] = false; }}
                onTouchStart={(e) => { e.preventDefault(); keys.current['arrowdown'] = true; keys.current[' '] = true; }}
                onTouchEnd={(e) => { e.preventDefault(); keys.current['arrowdown'] = false; keys.current[' '] = false; }}
              >
                <div className="flex flex-col gap-[2px] w-8 opacity-40 mb-1">
                  <div className="h-[2px] bg-white rounded-full" />
                  <div className="h-[2px] bg-white rounded-full" />
                  <div className="h-[2px] bg-white rounded-full" />
                </div>
                <span className="text-[8px] font-black tracking-widest text-rose-100 uppercase leading-none">Brake</span>
              </button>

              {/* Accelerator Pedal (Tall, Green) */}
              <button
                className="w-12 h-20 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 active:from-emerald-400 active:to-emerald-600 border-2 border-emerald-400/40 flex flex-col items-center justify-between py-2.5 select-none cursor-pointer shadow-md active:scale-95 transition-transform text-white"
                onMouseDown={() => { keys.current['arrowup'] = true; }}
                onMouseUp={() => { keys.current['arrowup'] = false; }}
                onMouseLeave={() => { keys.current['arrowup'] = false; }}
                onTouchStart={(e) => { e.preventDefault(); keys.current['arrowup'] = true; }}
                onTouchEnd={(e) => { e.preventDefault(); keys.current['arrowup'] = false; }}
              >
                <ArrowUp className="w-4 h-4 text-emerald-200 animate-bounce" />
                <div className="flex flex-col gap-[3px] w-5 opacity-40 my-1">
                  <div className="h-[1.5px] bg-white rounded-full" />
                  <div className="h-[1.5px] bg-white rounded-full" />
                  <div className="h-[1.5px] bg-white rounded-full" />
                  <div className="h-[1.5px] bg-white rounded-full" />
                </div>
                <span className="text-[8px] font-black tracking-widest text-emerald-100 uppercase leading-none">Gas</span>
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
