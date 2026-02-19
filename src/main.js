import {rayTracerCode, renderCode} from "./shaders.js"

// HTML element setup
let canvas = document.getElementById("pathTracerDisplay");
let frameDisplay = document.getElementById("frameDisplay");
let fpsDisplay = document.getElementById("fpsDisplay");
let timeDisplay = document.getElementById("timeDisplay");

canvas.width = Math.floor(window.innerWidth / 16) * 16;
canvas.height = Math.floor(window.innerHeight / 16) * 16;
console.log(canvas.width)
console.log(canvas.height)

// WebGPU setup
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice(); 
if (!device) {
	console.error("Sorry, your device doesn't support WebGPU :(");
}

const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

const context = canvas.getContext('webgpu');

context.configure({
	device,
	format: presentationFormat,
	alphaMode: 'premultiplied',
});

// -------------------------------------------- Program setup --------------------------------------------

var meshID = 20;

function rotatePointAroundOrigin(point, rotations) {
	let cY = Math.cos(rotations[1]);
	let cX = Math.cos(rotations[0]);
	let cZ = Math.cos(rotations[2]);
	let sY = Math.sin(rotations[1]);
	let sX = Math.sin(rotations[0]);
	let sZ = Math.sin(rotations[2]);

	var rotatedPoint = [];

	rotatedPoint.push((sX * sY * sZ + cY * cZ) * point[0] + (sX * sY * cZ - cY * sZ) * point[1] + (cX * sY) * point[2]);
	rotatedPoint.push((cX * sZ) * point[0] + (cX * cZ) * point[1] + (-sX) * point[2]);
	rotatedPoint.push((sX * cY * sZ - sY * cZ) * point[0] + (sX * cY * cZ + sY * sZ) * point[1] + (cX * cY) * point[2]);

	return rotatedPoint;
}

function createRectPrismRTObject(center, xl, yl, zl, albedo, material, emissiveColor, emissiveStrength, refractiveIndex, rotations) {
	let xN = center[0] - xl/2;
	let xP = center[0] + xl/2;
	let yN = center[1] - yl/2;
	let yP = center[1] + yl/2;
	let zN = center[2] - zl/2;
	let zP = center[2] + zl/2;

	let p1 = [rotatePointAroundOrigin([xN, yP, zN], rotations), 0];
	let p2 = [rotatePointAroundOrigin([xP, yP, zN], rotations), 0];
	let p3 = [rotatePointAroundOrigin([xN, yN, zN], rotations), 0];
	let p4 = [rotatePointAroundOrigin([xP, yN, zN], rotations), 0];
	let p5 = [rotatePointAroundOrigin([xN, yP, zP], rotations), 0];
	let p6 = [rotatePointAroundOrigin([xP, yP, zP], rotations), 0];
	let p7 = [rotatePointAroundOrigin([xN, yN, zP], rotations), 0];
	let p8 = [rotatePointAroundOrigin([xP, yN, zP], rotations), 0];

	let RTOI = [];

	for (let side = 0; side < 12; side++) {
		var RTFI = [];

		if (albedo.length == 3) {
			RTFI.push(albedo);
		} else {
			RTFI.push(albedo[side]);
		}

		if (typeof material == "number") {
			RTFI.push(material);
		} else {
			RTFI.push(material[side]);
		}

		if (emissiveColor.length == 3) {
			RTFI.push(emissiveColor);
		} else {
			RTFI.push(emissiveColor[side]);
		}

		if (typeof emissiveStrength == "number") {
			RTFI.push(emissiveStrength);
		} else {
			RTFI.push(emissiveStrength[side]);
		}

		if (typeof refractiveIndex == "number") {
			RTFI.push([refractiveIndex, 0, 0, 0]);
		} else {
			RTFI.push([refractiveIndex[side], 0, meshID, 0]);
		}

		RTOI.push(RTFI);
	}

	let t1 = [p1, p2, p4, RTOI[0]];
	let t2 = [p4, p3, p1, RTOI[1]];
	let t3 = [p5, p1, p3, RTOI[2]];
	let t4 = [p3, p7, p5, RTOI[3]];
	let t5 = [p7, p3, p8, RTOI[4]];
	let t6 = [p8, p3, p4, RTOI[5]];
	let t7 = [p2, p8, p4, RTOI[6]];
	let t8 = [p6, p8, p2, RTOI[7]];
	let t9 = [p6, p5, p7, RTOI[8]];
	let t10 = [p7, p8, p6, RTOI[9]];
	let t11 = [p2, p1, p5, RTOI[10]];
	let t12 = [p5, p6, p2, RTOI[11]];

	meshID += 1;

	return [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12].flat(10);

}

const rayModule = device.createShaderModule({
	label: 'ray processor',
	code: rayTracerCode,
});

const renderModule = device.createShaderModule({
	label: 'ray processor',
	code: renderCode,
});

// pipelines, pipeline layouts, and bindgroup layouts
const rayTracingBindGroupLayout = device.createBindGroupLayout({
	entries: [
		{
			binding: 0,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {
				type: "storage",
			},
		},
		{
			binding: 1,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {
				type: "uniform",
			},
		},
		{
			binding: 2,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {
				type: "read-only-storage",
			},
		},
		{
			binding: 3,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {
				type: "read-only-storage",
			},
		},
		{
			binding: 4,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {
				type: "read-only-storage",
			},
		},
		{
			binding: 5,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {
				type: "uniform",
			},
		},
		{
			binding: 6,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {
				type: "uniform",
			},
		},
		{
			binding: 7,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {
				type: "storage",
			},
		},
	],
});

const renderingBindGroupLayout = device.createBindGroupLayout({
	entries: [
		{
			binding: 0,
			visibility: GPUShaderStage.FRAGMENT,
			buffer: {
				type: "read-only-storage",
			},
		},
		{
			binding: 1,
			visibility: GPUShaderStage.FRAGMENT,
			buffer: {
				type: "uniform",
			},
		}
	],
});

const rayTracingPipelineLayout = device.createPipelineLayout({
	bindGroupLayouts: [rayTracingBindGroupLayout],
});

const renderingPipelineLayout = device.createPipelineLayout({
	bindGroupLayouts: [renderingBindGroupLayout],
});

const rayPipeline = device.createComputePipeline({
	label: 'compute pipeline',
	layout: rayTracingPipelineLayout,
	compute: {
		module: rayModule,
		entryPoint: 'raytracer'
	}
});

const renderPipeline = device.createRenderPipeline({
	label: 'render pipeline',
	layout: renderingPipelineLayout,
	vertex: {
		module: renderModule,
	},
	fragment: {
		module: renderModule,
		targets: [{ format: presentationFormat }],
	},
});

// ----------------------------------------------------- BUFFERS --------------------------------------------------------------------

// Raytracing & Display Buffer
const colorInputArray = new Float32Array(canvas.width * canvas.height * 4).fill(0);

const colorInputBuffer = device.createBuffer({
	label: 'color buffer',
	size: colorInputArray.byteLength,
	usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(colorInputBuffer, 0, colorInputArray);

// Raytracing Buffers
const colorOutputBuffer = device.createBuffer({
	label: 'result buffer',
	size: colorInputArray.byteLength,
	usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
});

// Camera

// camera rotation (radians)
let yaw = 0.0;
let pitch = 0.0;
let roll = 0.0;
let cY = Math.cos(yaw);
let cX = Math.cos(pitch);
let cZ = Math.cos(roll);
let sY = Math.sin(yaw);
let sX = Math.sin(pitch);
let sZ = Math.sin(roll);

// camera FOV (degrees)
let hFOV = 90;
let vFOV = 90;

let hFOVFactor = Math.tan(hFOV / 2 * Math.PI/180);
let vFOVFactor = Math.tan(vFOV / 2 * Math.PI/180);

let focalLength = 10;

const cameraInfo = new Float32Array([
	0, -1, 0, 0, // position (vec3f) (padded)
	2 * (canvas.width / canvas.height) * hFOVFactor * focalLength, 2 * vFOVFactor * focalLength, focalLength, 0.1, // projection plane width, height, focal length, and defocus blur factor

	// rotation matrix (3x3f) (padded)
	sX * sY * sZ + cY * cZ, sX * sY * cZ - cY * sZ, cX * sY, 0, 
	cX * sZ, cX * cZ, -sX, 0, 
	sX * cY * sZ - sY * cZ, sX * cY * cZ + sY * sZ, cX * cY, 0, 
	0, 0, 0, 0,
])

const cameraInfoBuffer = device.createBuffer({
	label: 'camera info buffer',
	size: cameraInfo.byteLength,
	usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(cameraInfoBuffer, 0, cameraInfo);

// Raytracing Objects

// Sphere Data Structure: vec3f pos, f32 radius, vec3f color, f32 materialType, vec3f emissive light, and f32 emission strength
let sphereArray = new Float32Array([
	//0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	5, -1, -5, 1, 1, 1, 1, 4, 0, 0, 0, 0, 1.5, 0, 0, 0,
	-5, -1, -10, 1, 1, 1, 1, 4, 0, 0, 0, 0, 1.5, 0, 0, 0,
	//0, 0, -2, 0.5, 1, 0, 1, 2, 0, 0, 0, 0, 1, 0, 0, 0,
	//10, 10, 0, 5, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0,
]);

const sphereBuffer = device.createBuffer({
	label: 'sphere buffer',
	size: sphereArray.byteLength,
	usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(sphereBuffer, 0, sphereArray);


// Plane Data Structure: vec3f normal, f32 dist, vec3f color, f32 materialType, vec3f emissive light, and f32 emission strength
let planeArray = new Float32Array([
	//0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	0, 1, 0, -10, 1, 1, 1, 5, 0, 0, 0, 0, 0, 0, 0, 0,
]);

const planeBuffer = device.createBuffer({
	label: 'plane buffer',
	size: planeArray.byteLength,
	usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
})
device.queue.writeBuffer(planeBuffer, 0, planeArray);

let boxAlbedo = [
	[0, 0, 0.8], 
	[0, 0, 0.8],
	[0.8, 0, 0],
	[0.8, 0, 0], 
	[0.8, 0.8, 0.8], 
	[0.8, 0.8, 0.8],
	[0, 0.8, 0], 
	[0, 0.8, 0], 
	[0.8, 0.8, 0.8],
	[0.8, 0.8, 0.8], 
	[0.8, 0.8, 0.8], 
	[0.8, 0.8, 0.8],
];

let boxRTO = createRectPrismRTObject([0, 0, 0], 5, 4, 5, boxAlbedo, 2, [0, 0, 0], 0, 1, [0, 0, 0]);
let lightPrismRTO = createRectPrismRTObject([0, 1.8, 0], 3, 0.1, 3, [1, 1, 1], 1, [1, 1, 1], 2, 1, [0, 0, 0]);
let clearPrismRTO = createRectPrismRTObject([0, 0, 0], 1, 1, 1, [1, 1, 1], 4, [0, 0, 0], 0, 2, [0, 0.78, 0]);
//let clearPrismRTO2 = createRectPrismRTObject([0, 0, 0], 0.5, 0.5, 0.5, [1, 1, 1], 4, [0, 0, 0], 0, 1, [0, 0.78, 0]);
//let lightPrismRTO2 = createRectPrismRTObject([0.5, 2, 0], 0.5, 0.1, 0.5, [1, 1, 1], 1, [1, 0.5, 1], 2);

// Triangle Data Structure: vec3f p1, vec3f p2, vec3f p3 (all padded), vec3f color, f32 materialType, vec3f emissive light, and f32 emission strength
//let triangleArray = new Float32Array([boxRTO, lightPrismRTO].flat());

let triangleArray = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);


const triangleBuffer = device.createBuffer({
	label: 'triangle buffer',
	size: triangleArray.byteLength,
	usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(triangleBuffer, 0, triangleArray);


// --------------------- RANDOM SEEDS ---------------------
let randomInfo = new Uint32Array([Date.now(), 0]);

const randomBuffer = device.createBuffer({
	label: 'random buffer',
	size: randomInfo.byteLength,
	usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(randomBuffer, 0, randomInfo);

// -------------- RAYTRACING SETTINGS ----------------------

let settingsInfo = new Uint32Array([3, 10]); // first number is rays per pixel, second number is ray bounces

const settingsBuffer = device.createBuffer({
	label: 'settings buffer',
	size: settingsInfo.byteLength,
	usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(settingsBuffer, 0, settingsInfo);

// rendering buffers
const screenInfo = new Float32Array([canvas.width, canvas.height])

const screenInfoBuffer = device.createBuffer({
	label: 'screen info buffer',
	size: screenInfo.byteLength,
	usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(screenInfoBuffer, 0, screenInfo);

const bInfo = new Float32Array(36).fill(0);

const bInfoBuffer = device.createBuffer({
	label: 'screen info buffer',
	size: bInfo.byteLength,
	usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(bInfoBuffer, 0, bInfo);

const bOutputBuffer = device.createBuffer({
	label: 'result buffer',
	size: bInfo.byteLength,
	usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
});

// bind groups
const rayTracingBindGroup = device.createBindGroup({
	label: 'rayTracing bindGroup',
	layout: rayPipeline.getBindGroupLayout(0),
	entries: [
		{binding: 0, resource: {buffer: colorInputBuffer}},
		{binding: 1, resource: {buffer: cameraInfoBuffer}},
		{binding: 2, resource: {buffer: sphereBuffer}},
		{binding: 3, resource: {buffer: planeBuffer}},
		{binding: 4, resource: {buffer: triangleBuffer}},
		{binding: 5, resource: {buffer: randomBuffer}},
		{binding: 6, resource: {buffer: settingsBuffer}},
		{binding: 7, resource: {buffer: bInfoBuffer}},
	], 
});

const renderingBindGroup = device.createBindGroup({
	label: 'rendering bindGroup',
	layout: renderPipeline.getBindGroupLayout(0),
	entries: [
		{binding: 0, resource: {buffer: colorInputBuffer }},
		{binding: 1, resource: {buffer: screenInfoBuffer }},
	],
});

// render pass descriptor for rendering
const renderPassDescriptor = {
	label: 'renderPassDescriptor',
	colorAttachments: [{
		clearValue: [0, 0, 0, 1],
		loadOp: 'clear',
		storeOp: 'store',
	}],
};

// functions to run WebGPU shaders
var frameNumber = 0;
var runTime = 0;

 
async function computeRayTracing() {
	// new random info every frame

	let randomInfo = new Int32Array([Date.now(), frameNumber]);
	device.queue.writeBuffer(randomBuffer, 0, randomInfo);
    console.log("ksks");
	const encoder = device.createCommandEncoder({ label: 'ray tracing encoder' });
	const pass = encoder.beginComputePass({ label: 'ray tracing compute pass' });
	pass.setPipeline(rayPipeline);
	pass.setBindGroup(0, rayTracingBindGroup);
	pass.dispatchWorkgroups(canvas.width / 16, canvas.height / 16); // workgroup max thread size is 256
	pass.end();
	encoder.copyBufferToBuffer(colorInputBuffer, 0, colorOutputBuffer, 0, colorOutputBuffer.size);
	encoder.copyBufferToBuffer(bInfoBuffer, 0, bOutputBuffer, 0, bOutputBuffer.size);

	const commandBuffer = encoder.finish();
	device.queue.submit([commandBuffer]);

	// getting results from shader
	fpsDisplay.innerText = "FPS: 0.14";
	await colorOutputBuffer.mapAsync(GPUMapMode.READ);
	fpsDisplay.innerText = "FPS: " + frameNumber;
	const output = new Float32Array(colorOutputBuffer.getMappedRange().slice());
	colorOutputBuffer.unmap();
	// if (Math.round(runTime) % 7 == 0) {
	// 	await bOutputBuffer.mapAsync(GPUMapMode.READ);
	// 	console.log(new Float32Array(bOutputBuffer.getMappedRange().slice())[0]);
	// 	bOutputBuffer.unmap();
	// }

	return output;
}


function render(colorInput) {
	device.queue.writeBuffer(colorInputBuffer, 0, colorInput); // write results into rendering input buffer

	renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

	const encoder = device.createCommandEncoder({ label: 'render encoder' });

	const pass = encoder.beginRenderPass(renderPassDescriptor);
	pass.setPipeline(renderPipeline);
	pass.setBindGroup(0, renderingBindGroup);
	pass.draw(6);
	pass.end();

	const commandBuffer = encoder.finish();
	device.queue.submit([commandBuffer]);
}

// main loop
async function main() {
	let colorResult = await computeRayTracing();
	render(colorResult);

	frameNumber += 1;
	frameDisplay.innerText = "Frame: " + frameNumber;
    

	// calculate and display fps and time elapsed
	endTime = Date.now();
	let timePassed = endTime - startTime;

	runTime += timePassed;
	timeDisplay.innerText = "Runtime: " + runTime / 1000 + "s";

	let fps = 1000 / timePassed;
	fpsDisplay.innerText = "FPS: " + Math.floor(fps);
	startTime = endTime;

	requestAnimationFrame(main);

}

var startTime = Date.now();
var endTime = Date.now();
main();
