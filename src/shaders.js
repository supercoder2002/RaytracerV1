export const rayTracerCode = `
	/* Basic Structs */
	struct Ray {
		origin: vec3f,
		dir: vec3f,
	}

	struct Camera {
		pos: vec3f,
		screenDim: vec2f,
		focalDist: f32,
		defocusFactor: f32,
		dirMat: mat3x3f,
	}

	// raytracing object descriptor
	struct RTODescriptor {
		albedo: vec3f, // color
		material: f32,
		emissiveColor: vec3f,
		emissiveStrength: f32,
		refractiveIndex: f32,
		collisionPriority: u32,
		meshID: u32,
	}

	struct Sphere {
		origin: vec3f,
		radius: f32,
		descriptor: RTODescriptor,
	}

	struct Plane {
		normal: vec3f,
		dist: f32,
		descriptor: RTODescriptor,
	}

	struct Triangle {
		p1: vec3f,
		p2: vec3f,
		p3: vec3f,
		descriptor: RTODescriptor,
	}

	struct CollisionData {
		hit: bool,
		hitPoint: vec3f,
		normal: vec3f,
		hitDist: f32,
		frontFace: bool, // true if front face, false if back face
	}

	// data for multiple collisions and object index
	struct CollisionsData {
		collisionData: CollisionData,
		nestCollisionData: CollisionData,
		index: u32,
		objectType: u32, // 1 - spheres, 2 - planes, 3 - triangles
		nestIndex: u32,
		nestObjectType: u32,
	}

	/* Constants */
	const noCollision = CollisionData(false, vec3f(0, 0, 0), vec3f(0, 0, 0), 0, false);
	const emptyDescriptor = RTODescriptor(vec3f(1, 0, 1), 0, vec3f(1, 0, 1), 0, 0, 0, 0);

	/* RNG */
	var<private> rngState: u32;

	/* Bindings */
	@group(0) @binding(0) var<storage, read_write> imageData: array<vec4<f32>>;
	@group(0) @binding(1) var<uniform> camera: Camera; // camera info
	@group(0) @binding(2) var<storage> spheres: array<Sphere>;
	@group(0) @binding(3) var<storage> planes: array<Plane>;
	@group(0) @binding(4) var<storage> triangles: array<Triangle>;
	@group(0) @binding(5) var<uniform> rngTimeInfo: vec2u; // first number is Unix timestamp, second is frameNumber
	@group(0) @binding(6) var<uniform> settings: vec2u; // first number is rays per pixel, second number is ray bounces
	@group(0) @binding(7) var<storage, read_write> bData: array<f32>;

	/* Functions */

	// PCG Functions
	fn pcgPRNG() -> u32 {
		let state = rngState;
		rngState = rngState * 747796405 + 2891336453;
		let word = ((state >> ((state >> 28) + 4)) ^ state) * 277803737;
		return (word >> 22) ^ word;
	}

	fn pcgHash(seed: u32) -> u32 {
		let state = seed * 747796405 + 2891336453;
		let word = ((state >> ((state >> 28) + 4)) ^ state) * 277803737;
		return (word >> 22) ^ word;
	}

	// RNG Functions
	fn randomFloat() -> f32 {
		pcgPRNG();
		return f32(rngState) / 4294967296;
	}

	// based on https://mathworld.wolfram.com/SpherePointPicking.html and https://www.mathworks.com/help/simulink/ref_extras/sphericaltocartesian.html
	fn randomPointOnSphere(radius: f32) -> vec3f {
		let u = randomFloat();
		let v = randomFloat();
		let theta = 2 * 3.14159 * u;
		let phi = acos(2 * v - 1);
		let x = radius * sin(phi) * cos(theta);
		let y = radius * sin(phi) * sin(theta);
		let z = radius * cos(phi);
		return vec3f(x, y, z);
	}

	fn randomDirInHemisphere(radius: f32, normal: vec3f) -> vec3f {
		var pointOnSphere = randomPointOnSphere(radius);
		if (dot(normal, pointOnSphere) < 0) {
			pointOnSphere = -pointOnSphere;
		}
		return pointOnSphere;
	}

	fn generateRandomDiskPoint(radius: f32) -> vec2f {
		let randomAngle = randomFloat() * 6.28;
		return vec2f(cos(randomAngle) * radius, -sin(randomAngle) * radius);
	}

	// Ray collsion functions
	fn raySphereIntersection(ray: Ray, sphere: Sphere, hitDistMin: f32, hitDistMax: f32) -> CollisionData {
		let vtr = sphere.origin - ray.origin; 
		let a = dot(ray.dir, ray.dir);
		let b = -2 * dot(ray.dir, vtr);
		let c = dot(vtr, vtr) - sphere.radius * sphere.radius;

		if ((b * b - 4 * a * c) > 0) {
			var hitDist = (-b - sqrt(b * b - 4 * a * c)) / (2 * a); // negative solution
			if ((hitDist < hitDistMin) || (hitDist > hitDistMax)) {
				hitDist = (-b + sqrt(b * b - 4 * a * c)) / (2 * a); // positive solution
				if ((hitDist < hitDistMin) || (hitDist > hitDistMax)) {
					return noCollision;
				}
			}
			let hitPoint = ray.origin + ray.dir * hitDist;
			var normal = (hitPoint - sphere.origin) / sphere.radius;
			let frontFace = (dot(normal, -ray.dir) > 0);
			if !(frontFace) {
				normal = -normal;
			}
			return CollisionData(true, hitPoint, normal, hitDist, frontFace);
		} else {
			return noCollision;
		}	
	}

	fn rayPlaneIntersection(ray: Ray, plane: Plane, hitDistMin: f32, hitDistMax: f32) -> CollisionData {
		let dProduct = dot(ray.dir, plane.normal);
		if (dProduct == 0) {
			return noCollision;
		} else {
			let hitDist = (plane.dist - dot(plane.normal, ray.origin)) / dProduct;
			if ((hitDist < hitDistMin) || (hitDist > hitDistMax)) {
				return noCollision;
			}
			let hitPoint = ray.origin + ray.dir * hitDist;
			let normal = normalize(plane.normal * -sign(dProduct));
			return CollisionData(true, hitPoint, normal, hitDist, sign(dProduct) < 0);
		}
	}

	fn rayTriangleIntersection(ray: Ray, triangle: Triangle, hitDistMin: f32, hitDistMax: f32) -> CollisionData {
		let normal = cross((triangle.p1 - triangle.p3), (triangle.p2 - triangle.p1));
		let d = dot(normal, triangle.p1);
		let planeCollision = rayPlaneIntersection(ray, Plane(normal, d, triangle.descriptor), hitDistMin, hitDistMax);
		if (planeCollision.hit) {
			let normalLength = length(normal);
			let uCross = cross(planeCollision.hitPoint - triangle.p2, triangle.p1 - planeCollision.hitPoint);
			let vCross = cross(planeCollision.hitPoint - triangle.p1, triangle.p3 - planeCollision.hitPoint);
			let wCross = cross(planeCollision.hitPoint - triangle.p3, triangle.p2 - planeCollision.hitPoint);
			let u = (length(uCross) / normalLength) * sign(dot(uCross, normal));
			let v = (length(vCross) / normalLength) * sign(dot(vCross, normal));
			let w = (length(wCross) / normalLength) * sign(dot(wCross, normal));
			if ((u < 0) || (v < 0) || (w < 0)) {
				return noCollision;
			} else {
				return planeCollision;
			}
		} else {
			return noCollision;
		}
	}

	fn rayObjectsIntersection(ray: Ray, hitDistMin: f32, hitDistMax: f32) -> CollisionsData {
		var closestCollision = CollisionsData(noCollision, noCollision, 0, 0, 0, 0);
		var lowestDist = hitDistMax;
		var nestDist = hitDistMax;

		for (var sphereIndex : u32 = 0; sphereIndex < u32(arrayLength(&spheres)); sphereIndex++) {
			let sphere = spheres[sphereIndex];
			let collision = raySphereIntersection(ray, sphere, hitDistMin, hitDistMax);

			if (collision.hit) {
				if (collision.hitDist < lowestDist) {
					if ((closestCollision.collisionData.hitDist != 0) && (!closestCollision.collisionData.frontFace)) {
						closestCollision.nestCollisionData = closestCollision.collisionData;
						closestCollision.nestIndex = closestCollision.index;
						closestCollision.nestObjectType = 1;
						nestDist = closestCollision.collisionData.hitDist;
					}
					closestCollision.collisionData = collision;
					closestCollision.index = sphereIndex;
					closestCollision.objectType = 1;

					lowestDist = collision.hitDist;
				} else if (collision.hitDist < nestDist) {
					if ((collision.hitDist != 0) && (!collision.frontFace)) {
						closestCollision.nestCollisionData = collision;
						closestCollision.nestIndex = sphereIndex;
						closestCollision.nestObjectType = 1;
						nestDist = collision.hitDist;
					}
				}
			} 
		}

		for (var planeIndex : u32 = 0; planeIndex < u32(arrayLength(&planes)); planeIndex++) {
			let plane = planes[planeIndex];
			let collision = rayPlaneIntersection(ray, plane, hitDistMin, hitDistMax);

			if (collision.hit) {
				if (collision.hitDist < lowestDist) {
					if ((closestCollision.collisionData.hitDist != 0) && (!closestCollision.collisionData.frontFace)) {
						closestCollision.nestCollisionData = closestCollision.collisionData;
						closestCollision.nestIndex = closestCollision.index;
						closestCollision.nestObjectType = 2;
						nestDist = closestCollision.collisionData.hitDist;
					}
					closestCollision.collisionData = collision;
					closestCollision.index = planeIndex;
					closestCollision.objectType = 2;

					lowestDist = collision.hitDist;
				} else if (collision.hitDist < nestDist) {
					if ((collision.hitDist != 0) && (!collision.frontFace)) {
						closestCollision.nestCollisionData = collision;
						closestCollision.nestIndex = planeIndex;
						closestCollision.nestObjectType = 2;
						nestDist = collision.hitDist;
					}
				}
			} 
		}

		for (var triangleIndex : u32 = 0; triangleIndex < u32(arrayLength(&triangles)); triangleIndex++) {
			let triangle = triangles[triangleIndex];
			let collision = rayTriangleIntersection(ray, triangle, hitDistMin, hitDistMax);

			if (collision.hit) {
				if (collision.hitDist < lowestDist) {
					if ((closestCollision.collisionData.hitDist != 0) && (!closestCollision.collisionData.frontFace)) {
						closestCollision.nestCollisionData = closestCollision.collisionData;
						closestCollision.nestIndex = closestCollision.index;
						closestCollision.nestObjectType = 3;
						nestDist = closestCollision.collisionData.hitDist;
					}
					closestCollision.collisionData = collision;
					closestCollision.index = triangleIndex;
					closestCollision.objectType = 3;

					lowestDist = collision.hitDist;
				} else if (collision.hitDist < nestDist) {
					if ((collision.hitDist != 0) && (!collision.frontFace)) {
						closestCollision.nestCollisionData = collision;
						closestCollision.nestIndex = triangleIndex;
						closestCollision.nestObjectType = 3;
						nestDist = collision.hitDist;
					}
				}
			} 
		}

		return closestCollision;
	}

	// Math functions
	fn modInt(q: i32, d: i32) -> i32 {
		return q - (q / d) * 2;
	}

	fn lerpColor(color1: vec3f, color2: vec3f, t: f32) -> vec3f {
		return color1 + (color2 - color1) * max(min(t, 1.0), 0.0);
	}

	// Other Functions
	fn calculateRefraction(entry: vec3f, normal: vec3f, r1: f32, r2: f32) -> vec4f {
		var exit = vec4f();

		let dotVal = dot(normal, -entry);
		let sinVal = (r1/r2) * sqrt(1 - dotVal * dotVal);

		let f0 = pow(((r1 - r2) / (r1 + r2)), 2); 
		let f = f0 + (1 - f0) * pow((1 - dotVal), 5); // fresnel coefficient

		if ((sinVal > 1) || (f > randomFloat())) { // reflect
			exit = vec4f(entry + normal * 2 * dot(normal, -entry), 0); 
		} else { // refract
			if ((-entry.x == normal.x) && (-entry.y == normal.y) && (-entry.z == normal.z)) { // edge case
				return vec4f(entry, 1); 
			} else {
				let cosVal = sqrt(1 - sinVal * sinVal);

				let crossDir = normalize(cross(-entry, normal));
				let sideDir = normalize(cross(crossDir, normal));
				let parallelComponent = -normal * cosVal;
				let perpendicularComponent = sideDir * sinVal;
				exit = vec4f(parallelComponent + perpendicularComponent, 1);
			}
		}
		return exit;
	}

	fn calculateRayColor(ray: Ray, bounceLimit: u32) -> vec3f {
		var pixelColor = vec3f(0, 0, 0); // final pixel color
		var reflectionColor = vec3f(1, 1, 1); // color of the ray when bouncing
		var mutRay = ray;

		var currentRefractiveIndex = 1.0;

		for (var bounce : u32 = 0; bounce < bounceLimit; bounce++) {
			let collisions = rayObjectsIntersection(mutRay, 0.00001, 100000);
			let collision = collisions.collisionData;

			if (!collision.hit) {
				pixelColor += lerpColor(vec3f(0.023, 0.379, 0.777), vec3f(0.762, 0.859, 0.965), 1 - mutRay.dir.y) * reflectionColor; // sky color
				return pixelColor;
			}

			var descriptor = emptyDescriptor; // description of raytracing object

			if (collisions.objectType == 1) {
				descriptor = spheres[collisions.index].descriptor;
			} else if (collisions.objectType == 2) {
				descriptor = planes[collisions.index].descriptor;
			} else if (collisions.objectType == 3) {
				descriptor = triangles[collisions.index].descriptor;
			}

			pixelColor += descriptor.emissiveColor * reflectionColor * descriptor.emissiveStrength;

			// texture color handling
			if (descriptor.material == 5) { // checkerboard pattern
				let yMat = mat3x3f(1, 0, 0, 0, 0, -1, 0, 1, 0);

				let yPlaneAxis = yMat * collision.normal;
				let xPlaneAxis = cross(yPlaneAxis, collision.normal);

				let relativeX = dot(collision.hitPoint, xPlaneAxis);
				let relativeY = dot(collision.hitPoint, yPlaneAxis);

				let iX = i32(floor(relativeX * 0.1 + 0.0001));
				let iY = i32(floor(relativeY * 0.1 + 0.0001));

				if (modInt(iX, 2) == 0){
					if (modInt(iY, 2) == 0){
						reflectionColor *= descriptor.albedo;
					} else {
						reflectionColor *= vec3f(0, 0, 0);
					}
				} else {
					if (modInt(iY, 2) == 0){
						reflectionColor *= vec3f(0, 0, 0);
					} else {
						reflectionColor *= descriptor.albedo;
					}
				}
					
			} else {
				reflectionColor *= descriptor.albedo;
			}

			if ((reflectionColor.x == 0) && (reflectionColor.y == 0) && (reflectionColor.z == 0)) {
				return pixelColor;
			}

			mutRay.origin = collision.hitPoint;

			// ray bounce handling
			if (descriptor.material == 1) { // uniform diffuse
				mutRay.dir = normalize(randomDirInHemisphere(1, collision.normal));

			} else if ((descriptor.material == 2) || (descriptor.material == 5)) { // lambertian diffuse
				mutRay.dir = normalize(collision.normal + randomPointOnSphere(1));

			} else if (descriptor.material == 3) { // reflective (metal)
				mutRay.dir = normalize(mutRay.dir + collision.normal * 2 * dot(-mutRay.dir, collision.normal));

			} else if (descriptor.material == 4) { // refractive (glass)
				var refractionResult = vec4f();

				if (collision.frontFace) {
					refractionResult = calculateRefraction(mutRay.dir, collision.normal, currentRefractiveIndex, descriptor.refractiveIndex);
					if (refractionResult.w == 1) {
						currentRefractiveIndex = descriptor.refractiveIndex;
					}
				} else {
					if (collisions.nestCollisionData.hitDist != 0) {
						var nestObjectDescriptor = emptyDescriptor;

						if (collisions.nestObjectType == 1) {
							nestObjectDescriptor = spheres[collisions.nestIndex].descriptor;
						} else if (collisions.nestObjectType == 2) {
							nestObjectDescriptor = planes[collisions.nestIndex].descriptor;
						} else if (collisions.nestObjectType == 3) {
							nestObjectDescriptor = triangles[collisions.nestIndex].descriptor;
						}
						refractionResult = calculateRefraction(mutRay.dir, collision.normal, descriptor.refractiveIndex, nestObjectDescriptor.refractiveIndex);
						if (refractionResult.w == 1) {
							currentRefractiveIndex = nestObjectDescriptor.refractiveIndex;
						} 
					} else {
						refractionResult = calculateRefraction(mutRay.dir, collision.normal, descriptor.refractiveIndex, 1);

						if (refractionResult.w == 1) {
							currentRefractiveIndex = 1.0;
						}
					}
				}

				mutRay.dir = refractionResult.xyz;

			} else {
				return pixelColor;
			}
		}
		return pixelColor;
	}

	// Main function
	@compute @workgroup_size(16, 16) fn raytracer(@builtin(num_workgroups) num_workgroups: vec3u, @builtin(workgroup_id) workgroup_id : vec3u, 
	@builtin(local_invocation_index) local_invocation_index: u32) {
		let i = (workgroup_id.x + (workgroup_id.y + local_invocation_index * num_workgroups.y) * num_workgroups.x);

		// pixel coordinates
		let idX = i % (num_workgroups.x * 16);
		let idY = u32(trunc(f32(i) / f32(num_workgroups.x * 16)));

		// ray target is point on image screen relative to camera
		var rayTarget = vec3f();
		rayTarget.x = -1.0/2.0 * camera.screenDim.x + (f32(idX)/f32(num_workgroups.x * 16)) * camera.screenDim.x;
		rayTarget.y = 1.0/2.0 * camera.screenDim.y - (f32(idY)/f32(num_workgroups.y * 16)) * camera.screenDim.y;
		rayTarget.z = -camera.focalDist;

		// RNG
		rngState = pcgHash(i * rngTimeInfo[0]);

		// ray color calculation
		var totalColor = vec3f(0, 0, 0);
		for (var rayIndex: u32 = 0; rayIndex < settings[0]; rayIndex++) {
			let defocus = camera.dirMat * vec3f(generateRandomDiskPoint(camera.defocusFactor), 0); // defocus blur calculation

			let newOrigin = camera.pos + defocus; // origin of the ray with defocus

			var newRayTarget = rayTarget - defocus;
			newRayTarget.x += ((randomFloat() - 0.5) / f32(num_workgroups.x * 16) * camera.screenDim.x);
			newRayTarget.y += ((randomFloat() - 0.5) / f32(num_workgroups.y * 16) * camera.screenDim.y);

			let newDir = normalize(camera.dirMat * newRayTarget); // apply camera orientation

			let ray = Ray(newOrigin, newDir);

			totalColor += calculateRayColor(ray, settings[1]) / f32(settings[0]);
		}
		
		// write color to imageData (less contribution for each frame that passes)
		imageData[i] = vec4f(lerpColor(imageData[i].xyz, totalColor, 1 / (f32(rngTimeInfo[1]) + 1)), 1);
	}
`

export const renderCode = `
	@group(0) @binding(0) var<storage> imageData: array<vec4<f32>>;
	@group(0) @binding(1) var<uniform> screenDim: vec2f;

	@vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
		let pos = array(
			vec2f(-1, 1),
			vec2f(1, 1),
			vec2f(1, -1),
			vec2f(1, -1),
			vec2f(-1, -1),
			vec2f(-1, 1),
		); // entire screen
		return vec4f(pos[vertexIndex], 0.0, 1.0);
	}
		
	@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
		let i = u32(u32(pos.x) + u32(pos.y) * u32(screenDim.x));
		return imageData[i];
	}
`
