import {
	GPUComposer,
	GPUProgram,
	GPULayer,
	SHORT,
	INT,
	FLOAT,
	NEAREST,
	LINEAR,
	REPEAT,
} from 'gpu-io';

// Scaling factor for touch interactions.
const TOUCH_FORCE_SCALE = 2;
const ADD_MATERIAL_SCALE = 0.5;
const MATERIAL_DECAY = 0.995;
const MATERIAL_TOUCH_RADIUS = 50;
// Approx avg num particles per px.
const PARTICLE_DENSITY = 0.1;
const MAX_NUM_PARTICLES = 100000;
// How long do the particles last before they are reset.
// If we don't have then reset they tend to clump up.
const PARTICLE_LIFETIME = 1000;
// How many steps to compute the zero pressure field.
const NUM_JACOBI_STEPS = 5;
const PRESSURE_CALC_ALPHA = -1;
const PRESSURE_CALC_BETA = 0.25;
export const PARAMS = {
	VELOCITY_DECAY: 1,
};
const VELOCITY_TOUCH_RADIUS = 30;
// Compute the velocity at a lower resolution to increase efficiency.
const VELOCITY_SCALE_FACTOR = 8;
// Put a speed limit on velocity, otherwise touch interactions get out of control.
const MAX_VELOCITY = 30;
// We are storing abs position (2 components) and displacements (2 components) in this buffer.
// This decreases error when rendering to half float.
const POSITION_NUM_COMPONENTS = 4;

export const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

// Calc the number of particles based on simulation dimensions.
function calcNumParticles(width: number, height: number) {
	return Math.min(Math.ceil(width * height * ( PARTICLE_DENSITY)), MAX_NUM_PARTICLES);
}
let NUM_PARTICLES = calcNumParticles(canvas.width, canvas.height);

// gpu-io composer.
const composer = new GPUComposer({ canvas });

// Init state.
const width = canvas.clientWidth;
const height = canvas.clientHeight;
const velocityState = new GPULayer(composer, {
	name: 'velocity',
	dimensions: [Math.ceil(width / VELOCITY_SCALE_FACTOR), Math.ceil(height / VELOCITY_SCALE_FACTOR)],
	type: FLOAT,
	filter: LINEAR,
	numComponents: 2,
	wrapX: REPEAT,
	wrapY: REPEAT,
	numBuffers: 2,
});
const divergenceState = new GPULayer(composer, {
	name: 'divergence',
	dimensions: [velocityState.width, velocityState.height],
	type: FLOAT,
	filter: NEAREST,
	numComponents: 1,
	wrapX: REPEAT,
	wrapY: REPEAT,
});
const pressureState = new GPULayer(composer, {
	name: 'pressure',
	dimensions: [velocityState.width, velocityState.height],
	type: FLOAT,
	filter: NEAREST,
	numComponents: 1,
	wrapX: REPEAT,
	wrapY: REPEAT,
	numBuffers: 2,
});
const materialState = new GPULayer(composer, {
	name: 'material',
	dimensions: [width, height],
	type: FLOAT,
	filter: LINEAR,
	numComponents: 1,
	wrapX: REPEAT,
	wrapY: REPEAT,
	numBuffers: 2,
});
const particlePositionState = new GPULayer(composer, {
	name: 'position',
	dimensions: NUM_PARTICLES,
	type: FLOAT,
	numComponents: POSITION_NUM_COMPONENTS,
	numBuffers: 2,
});
// We can use the initial state to reset particles after they've "died".
const particleInitialState = new GPULayer(composer, {
	name: 'initialPosition',
	dimensions: NUM_PARTICLES,
	type: FLOAT,
	numComponents: POSITION_NUM_COMPONENTS,
	numBuffers: 1,
});
const particleAgeState = new GPULayer(composer, {
	name: 'age',
	dimensions: NUM_PARTICLES,
	type: SHORT,
	numComponents: 1,
	numBuffers: 2,
});

// Init programs.
const advection = new GPUProgram(composer, {
	name: 'advection',
	fragmentShader: `
	in vec2 v_uv;

	uniform sampler2D u_state;
	uniform sampler2D u_velocity;
	uniform vec2 u_dimensions;
	uniform float u_decay;

	out vec2 out_state;

	void main() {
		// Implicitly solve advection.
		out_state = texture(u_state, v_uv - texture(u_velocity, v_uv).xy / u_dimensions).xy * u_decay;
	}`,
	uniforms: [
		{
			name: 'u_state',
			value: 0,
			type: INT,
		},
		{
			name: 'u_velocity',
			value: 1,
			type: INT,
		},
		{
			name: 'u_decay',
			value: 1,
			type: FLOAT,
		},
	],
});
const divergence2D = new GPUProgram(composer, {
	name: 'divergence2D',
	fragmentShader: `
	in vec2 v_uv;

	uniform sampler2D u_vectorField;
	uniform vec2 u_pxSize;

	out float out_divergence;

	void main() {
		float n = texture(u_vectorField, v_uv + vec2(0, u_pxSize.y)).y;
		float s = texture(u_vectorField, v_uv - vec2(0, u_pxSize.y)).y;
		float e = texture(u_vectorField, v_uv + vec2(u_pxSize.x, 0)).x;
		float w = texture(u_vectorField, v_uv - vec2(u_pxSize.x, 0)).x;
		out_divergence = 0.5 * ( e - w + n - s);
	}`,
});
const jacobi = new GPUProgram(composer, {
	name: 'jacobi',
	fragmentShader: `
	in vec2 v_uv;

	uniform float u_alpha;
	uniform float u_beta;
	uniform vec2 u_pxSize;
	uniform sampler2D u_previousState;
	uniform sampler2D u_divergence;

	out vec4 out_jacobi;

	void main() {
		vec4 n = texture(u_previousState, v_uv + vec2(0, u_pxSize.y));
		vec4 s = texture(u_previousState, v_uv - vec2(0, u_pxSize.y));
		vec4 e = texture(u_previousState, v_uv + vec2(u_pxSize.x, 0));
		vec4 w = texture(u_previousState, v_uv - vec2(u_pxSize.x, 0));
		vec4 d = texture(u_divergence, v_uv);
		out_jacobi = (n + s + e + w + u_alpha * d) * u_beta;
	}`,
	uniforms: [
		{
			name: 'u_alpha',
			value: PRESSURE_CALC_ALPHA,
			type: FLOAT,
		},
		{
			name: 'u_beta',
			value: PRESSURE_CALC_BETA,
			type: FLOAT,
		},
		{
			name: 'u_previousState',
			value: 0,
			type: INT,
		},
		{
			name: 'u_divergence',
			value: 1,
			type: INT,
		},
	],
});
const gradientSubtraction = new GPUProgram(composer, {
	name: 'gradientSubtraction',
	fragmentShader: `
	in vec2 v_uv;

	uniform vec2 u_pxSize;
	uniform sampler2D u_scalarField;
	uniform sampler2D u_vectorField;

	out vec2 out_result;

	void main() {
		float n = texture(u_scalarField, v_uv + vec2(0, u_pxSize.y)).r;
		float s = texture(u_scalarField, v_uv - vec2(0, u_pxSize.y)).r;
		float e = texture(u_scalarField, v_uv + vec2(u_pxSize.x, 0)).r;
		float w = texture(u_scalarField, v_uv - vec2(u_pxSize.x, 0)).r;

		out_result = texture2D(u_vectorField, v_uv).xy - 0.5 * vec2(e - w, n - s);
	}`,
	uniforms: [
		{
			name: 'u_scalarField',
			value: 0,
			type: INT,
		},
		{
			name: 'u_vectorField',
			value: 1,
			type: INT,
		},
	],
});
const renderParticles = new GPUProgram(composer, {
	name: 'renderParticles',
	fragmentShader: `
	#define FADE_TIME 0.1

	in vec2 v_uv;
	in vec2 v_uv_position;

	uniform isampler2D u_ages;
	uniform sampler2D u_velocity;

	out vec4 out_color;

	void main() {
		float ageFraction = float(texture(u_ages, v_uv_position).x) / ${PARTICLE_LIFETIME.toFixed(1)};
		// Fade first 10% and last 10%.
		float opacity = mix(0.0, 1.0, min(ageFraction * 10.0, 1.0)) * mix(1.0, 0.0, max(ageFraction * 10.0 - 90.0, 0.0));
		vec2 velocity = texture(u_velocity, v_uv).xy;
		// Show the fastest regions with darker color.
		float multiplier = clamp(dot(velocity, velocity) * 0.05 + 0.7, 0.0, 1.0);
		out_color = vec4(0, 0, 0.2, opacity * multiplier);
	}`,
	uniforms: [
		{
			name: 'u_ages',
			value: 0,
			type: INT,
		},
		{
			name: 'u_velocity',
			value: 1,
			type: INT,
		},
	],
});
const ageParticles = new GPUProgram(composer, {
	name: 'ageParticles',
	fragmentShader: `
	in vec2 v_uv;

	uniform isampler2D u_ages;

	out int out_age;

	void main() {
		int age = texture(u_ages, v_uv).x + 1;
		out_age = stepi(age, ${PARTICLE_LIFETIME}) * age;
	}`,
});
const advectParticles = new GPUProgram(composer, {
	name: 'advectParticles',
	fragmentShader: `
	in vec2 v_uv;

	uniform vec2 u_dimensions;
	uniform sampler2D u_positions;
	uniform sampler2D u_velocity;
	uniform isampler2D u_ages;
	uniform sampler2D u_initialPositions;

	out vec4 out_position;

	void main() {
		// Store small displacements as separate number until they accumulate sufficiently.
		// Then add them to the absolution position.
		// This prevents small offsets on large abs positions from being lost in float16 precision.
		vec4 positionData = texture(u_positions, v_uv);
		vec2 absolute = positionData.rg;
		vec2 displacement = positionData.ba;
		vec2 position = absolute + displacement;

		// Forward integrate via RK2.
		vec2 pxSize = 1.0 / u_dimensions;
		vec2 velocity1 = texture(u_velocity, position * pxSize).xy;
		vec2 halfStep = position + velocity1 * 0.5;
		displacement += texture(u_velocity, halfStep * pxSize).xy;

		// Merge displacement with absolute if needed.
		float shouldMerge = step(20.0, dot(displacement, displacement));
		// Also wrap absolute position if needed.
		absolute = mod(absolute + shouldMerge * displacement + u_dimensions, u_dimensions);
		displacement *= (1.0 - shouldMerge);

		// If this particle is being reset, give it a random position.
		int shouldReset = stepi(texture(u_ages, v_uv).x, 1);
		out_position = mix(vec4(absolute, displacement), texture(u_initialPositions, v_uv), float(shouldReset));
	}`,
	uniforms: [
		{
			name: 'u_positions',
			value: 0,
			type: INT,
		},
		{
			name: 'u_velocity',
			value: 1,
			type: INT,
		},
		{
			name: 'u_ages',
			value: 2,
			type: INT,
		},
		{
			name: 'u_initialPositions',
			value: 3,
			type: INT,
		},
	],
});
const renderMaterial = new GPUProgram(composer, {
	name: 'renderMaterial',
	fragmentShader: `
	#define BACKGROUND vec3(0.98, 0.922, 0.843)
	#define COLOR1 vec3(0.925, 0, 0.55)
	#define COLOR2 vec3(0.0, 0.70, 0.63)
	#define COLOR3 vec3(0.52, 0.81, 0.70)
	#define NUM_COLORS 3.0

	in vec2 v_uv;

	uniform sampler2D u_material;

	out vec4 out_color;

	void main() {
		float val = clamp(texture(u_material, v_uv).x, 0.0, 1.0);
		float mix1 = step(val, 1.0 / NUM_COLORS);
		float mix2 = step(val, 2.0 / NUM_COLORS) * (1.0 - mix1);
		float mix3 = (1.0 - mix1) * (1.0 - mix2);
		vec3 color =
			mix(BACKGROUND, COLOR1, val * NUM_COLORS) * mix1 +
			mix(COLOR1, COLOR2, val * NUM_COLORS - 1.0) * mix2 +
			mix(COLOR2, COLOR3, val * NUM_COLORS - 2.0) * mix3;
		out_color = vec4(color, 1);
	}`,
});
// During touch, copy data from noise over to state.
const touchVelocity = new GPUProgram(composer, {
	name: 'touchVelocity',
	fragmentShader: `
	in vec2 v_uv;
	in vec2 v_uv_local;

	uniform sampler2D u_velocity;
	uniform vec2 u_vector;
	uniform float u_maxVelocity;

	out vec2 out_velocity;

	void main() {
		vec2 radialVec = (v_uv_local * 2.0 - 1.0);
		float radiusSq = 1.0 - dot(radialVec, radialVec);
		// Update velocity.
		vec2 velocity = texture(u_velocity, v_uv).xy + radiusSq * u_vector * ${TOUCH_FORCE_SCALE.toFixed(1)};
		float velocityMag = length(velocity);
		out_velocity = velocity / velocityMag * min(velocityMag, u_maxVelocity);
	}`,
	uniforms: [
		{
			name: 'u_vector',
			value: [0, 0],
			type: FLOAT,
		},
		{
			name: 'u_maxVelocity',
			value: MAX_VELOCITY,
			type: FLOAT,
		},
	],
});
const touchMaterial = new GPUProgram(composer, {
	name: 'touchMaterial',
	fragmentShader: `
	in vec2 v_uv;
	in vec2 v_uv_local;

	uniform sampler2D u_material;

	out float out_material;

	void main() {
		vec2 radialVec = (v_uv_local * 2.0 - 1.0);
		float radiusSq = clamp(1.0 - dot(radialVec, radialVec), 0.0, 1.0);
		// Update material.
		out_material = clamp(texture(u_material, v_uv).x + radiusSq * ${ADD_MATERIAL_SCALE.toFixed(1)}, 0.0, 1.0);
	}`,
});

export function onResize() {
	const width = window.innerWidth;
	const height = window.innerHeight;

	// Resize composer.
	composer.resize([width, height]);

	// Re-init textures at new size.
	const velocityDimensions = [Math.ceil(width / VELOCITY_SCALE_FACTOR), Math.ceil(height / VELOCITY_SCALE_FACTOR)];
	velocityState.resize(velocityDimensions);
	divergenceState.resize(velocityDimensions);
	pressureState.resize(velocityDimensions);
	materialState.resize([width, height]);

	// Update uniforms.
	advection.setUniform('u_dimensions', [width, height], FLOAT);
	advectParticles.setUniform('u_dimensions', [width, height], FLOAT);
	const velocityPxSize = [1 / velocityDimensions[0], 1 / velocityDimensions[1]];
	divergence2D.setUniform('u_pxSize', velocityPxSize, FLOAT);
	jacobi.setUniform('u_pxSize', velocityPxSize, FLOAT);
	gradientSubtraction.setUniform('u_pxSize', velocityPxSize, FLOAT);
	
	// Re-init particles.
	NUM_PARTICLES = calcNumParticles(width, height);
	// Init new positions.
	const positions = new Float32Array(NUM_PARTICLES * 4);
	for (let i = 0; i < positions.length / 4; i++) {
		positions[POSITION_NUM_COMPONENTS * i] = Math.random() * width;
		positions[POSITION_NUM_COMPONENTS * i + 1] = Math.random() * height;
	}
	particlePositionState.resize(NUM_PARTICLES, positions);
	particleInitialState.resize(NUM_PARTICLES, positions);
	// Init new ages.
	const ages = new Int16Array(NUM_PARTICLES);
	for (let i = 0; i < NUM_PARTICLES; i++) {
		ages[i] = Math.round(Math.random() * PARTICLE_LIFETIME);
	}
	particleAgeState.resize(NUM_PARTICLES, ages);

	// Render something to the screen to start.
	stepRender();
}

export function stepTouch(current: [number, number], last?: [number, number]) {
	if (last) {
		if (current[0] === last[0] && current[1] === last[1]) return;
		touchVelocity.setUniform('u_vector', [current[0] - last[0], - (current[1] - last[1])]);
		touchVelocity.setUniform('u_maxVelocity', MAX_VELOCITY);
		composer.stepSegment({
			program: touchVelocity,
			input: velocityState,
			output: velocityState,
			position1: [current[0], canvas.clientHeight - current[1]],
			position2: [last[0], canvas.clientHeight - last[1]],
			thickness: VELOCITY_TOUCH_RADIUS,
			endCaps: true,
		});
		composer.stepSegment({
			program: touchMaterial,
			input: materialState,
			output: materialState,
			position1: [current[0], canvas.clientHeight - current[1]],
			position2: [last[0], canvas.clientHeight - last[1]],
			thickness: MATERIAL_TOUCH_RADIUS,
			endCaps: true,
		});
	} else {
		// Pick a random vector direction.
		const scale = 100;
		const x = Math.random() * (Math.random() < 0.5 ? 1 : -1);
		const y = Math.sqrt(1 - x * x) * (Math.random() < 0.5 ? 1 : -1);
		touchVelocity.setUniform('u_vector', [x * scale, y * scale]);
		touchVelocity.setUniform('u_maxVelocity', scale * 2);
		composer.stepCircle({
			program: touchVelocity,
			input: velocityState,
			output: velocityState,
			position: [current[0], canvas.clientHeight - current[1]],
			diameter: VELOCITY_TOUCH_RADIUS * 2,
		});
		composer.stepCircle({
			program: touchMaterial,
			input: materialState,
			output: materialState,
			position: [current[0], canvas.clientHeight - current[1]],
			diameter: MATERIAL_TOUCH_RADIUS * 2,
		});
	}
}

export function stepSimulation() {
	// Advect the velocity vector field.
	advection.setUniform('u_decay', PARAMS.VELOCITY_DECAY);
	composer.step({
		program: advection,
		input: [velocityState, velocityState],
		output: velocityState,
	});
	// Advect the material field.
	advection.setUniform('u_decay', MATERIAL_DECAY);
	composer.step({
		program: advection,
		input: [materialState, velocityState],
		output: materialState,
	});
	// Compute divergence of advected velocity field.
	composer.step({
		program: divergence2D,
		input: velocityState,
		output: divergenceState,
	});
	// Compute the pressure gradient of the advected velocity vector field (using jacobi iterations).
	for (let i = 0; i < NUM_JACOBI_STEPS; i++) {
		composer.step({
			program: jacobi,
			input: [pressureState, divergenceState],
			output: pressureState,
		});
	}
	// Subtract the pressure gradient from velocity to obtain a velocity vector field with zero divergence.
	composer.step({
		program: gradientSubtraction,
		input: [pressureState, velocityState],
		output: velocityState,
	});

	// Increment particle age.
	composer.step({
		program: ageParticles,
		input: particleAgeState,
		output: particleAgeState,
	});
	// Advect particles.
	composer.step({
		program: advectParticles,
		input: [particlePositionState, velocityState, particleAgeState, particleInitialState],
		output: particlePositionState,
	});
	
	stepRender();
}

function stepRender() {
	// Render material.
	composer.step({
		program: renderMaterial,
		input: materialState,
	});
	// Render particles to texture for trail effect.
	composer.drawLayerAsPoints({
		layer: particlePositionState,
		pointSize: 1,
		program: renderParticles,
		input: [particleAgeState, velocityState],
		wrapX: true,
		wrapY: true,
		blendAlpha: true,
	});
}