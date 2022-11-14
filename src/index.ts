import {
	canvas,
	onResize,
	PARAMS,
	stepSimulation,
	stepTouch,
} from './simulation';

// Simulation is paused until touches start.
const TIMER_MAX = 15 * 60; // Set a timer for 15 seconds.
let pausedTimer = TIMER_MAX;
let paused = true; // Set as initially paused.
function resetTimer() {
	pausedTimer = TIMER_MAX;
	if (paused) {
		paused = false;
		console.log('START');
		loop();
	}
}

// Resize if needed.
window.addEventListener('resize', onResize);
onResize();

// Animation loop.
function loop() {
	pausedTimer--;
	// Bump up the damping toward the end of the timer.
	PARAMS.VELOCITY_DECAY = pausedTimer < 150 ? 0.98 : 1;
	paused = pausedTimer <= 0;
	if (paused) {
		console.log('PAUSE');
		return;
	}
	window.requestAnimationFrame(loop);
	stepSimulation();
}

// Touch events.
const activeTouches: {[key: string]: {
	current: [number, number],
	last?: [number, number],
}} = {};

function onPointerMove(e: PointerEvent) {
	resetTimer();
	e.preventDefault();
	e.stopPropagation();
	const x = e.clientX;
	const y = e.clientY;
	let current = [x, y] as [number, number];
	let last: [number, number] | undefined = undefined;
	if (activeTouches[e.pointerId] === undefined) {
		activeTouches[e.pointerId] = {
			current,
		}
	} else {
		last = activeTouches[e.pointerId].current;
		activeTouches[e.pointerId].last = last;
		activeTouches[e.pointerId].current = current;
	}
	stepTouch(current, last);
}
function onPointerStop(e: PointerEvent) {
	delete activeTouches[e.pointerId];
}
canvas.addEventListener('pointerdown', onPointerMove);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerStop);
canvas.addEventListener('pointerout', onPointerStop);
canvas.addEventListener('pointercancel', onPointerStop);
// Stop propagation of touch events.
// This prevents page scrolling in case of embedded iframe.
canvas.ontouchmove = (e) => {
    e.preventDefault();
	e.stopPropagation();
}