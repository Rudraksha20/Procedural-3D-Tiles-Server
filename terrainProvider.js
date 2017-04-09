
'use strict';

const Cesium = require('cesium');
const gltfPipeline = require('gltf-pipeline');
const glbToB3dm = require('3d-tiles-tools/lib/glbToB3dm');
const addPipelineExtras = gltfPipeline.addPipelineExtras;
const getBinaryGltf = gltfPipeline.getBinaryGltf;
const loadGltfUris = gltfPipeline.loadGltfUris;
const processJSON = gltfPipeline.Pipeline.processJSON;
const addCesiumRTC = gltfPipeline.addCesiumRTC;

function TerrainProvider(treeProvider) {
  this.treeProvider = treeProvider;
}

var scratchCartographic = new Cesium.Cartographic();
var scratchCartesian = new Cesium.Cartesian3();

function setPosition(originlon, originlat, lon, lat, height, result) {
  Cesium.Cartographic.fromRadians(lon, lat, height, scratchCartographic);
  Cesium.Ellipsoid.WGS84.cartographicToCartesian(scratchCartographic, scratchCartesian);
  result[0] = scratchCartesian.x;
  result[1] = scratchCartesian.y;
  result[2] = scratchCartesian.z;

  // position is relative to southwest corner
  Cesium.Cartographic.fromRadians(originlon, originlat, 0, scratchCartographic);
  Cesium.Ellipsoid.WGS84.cartographicToCartesian(scratchCartographic, scratchCartesian);
  result[0] -= scratchCartesian.x;
  result[1] -= scratchCartesian.y;
  result[2] -= scratchCartesian.z;
}

function setNormal(lon, lat, height, result) {
  Cesium.Cartographic.fromRadians(lon, lat, height, scratchCartographic);
  Cesium.Ellipsoid.WGS84.geodeticSurfaceNormalCartographic(scratchCartographic, scratchCartesian);
  result[0] = scratchCartesian.x;
  result[1] = scratchCartesian.y;
  result[2] = scratchCartesian.z;
}

TerrainProvider.prototype.generateTerrain = function(hemisphere, index) {
  // west, south, east, north
  var region = this.treeProvider.generateBoundingRegion(hemisphere, index);

  var northPole = (region[3] === Math.PI / 2);
  var southPole = (region[1] === -Math.PI / 2);
  var pole = northPole || southPole;

  var vertexCount =  pole ? 3 : 4;
  var indexCount = 3 * (vertexCount - 2);

  var indices = new Uint16Array(indexCount);
  var normals = new Float32Array(3*vertexCount);
  var positions = new Float32Array(3*vertexCount);

  var componentBytes = 3 * Float32Array.BYTES_PER_ELEMENT;
  var corner;

  corner = 0;
  setPosition(region[0], region[1], region[0], region[1], 0, new Float32Array(positions.buffer, componentBytes*(corner++), 3)); // south west
  if (!southPole) setPosition(region[0], region[1], region[2], region[1], 0, new Float32Array(positions.buffer, componentBytes*(corner++), 3)); // south east
  setPosition(region[0], region[1], region[2], region[3], 0, new Float32Array(positions.buffer, componentBytes*(corner++), 3)); // north east
  if (!northPole) setPosition(region[0], region[1], region[0], region[3], 0, new Float32Array(positions.buffer, componentBytes*(corner++), 3)); // north west

  corner = 0;
  setNormal(region[0], region[1], 0, new Float32Array(normals.buffer, componentBytes*(corner++), 3));
  if (!southPole) setNormal(region[2], region[1], 0, new Float32Array(normals.buffer, componentBytes*(corner++), 3));
  setNormal(region[2], region[3], 0, new Float32Array(normals.buffer, componentBytes*(corner++), 3));
  if (!northPole) setNormal(region[0], region[3], 0, new Float32Array(normals.buffer, componentBytes*(corner++), 3));

  var minPosition = [positions[0], positions[1], positions[2]];
  var maxPosition = [positions[0], positions[1], positions[2]];

  let padding = 0;
  for (let i = 0; i < vertexCount; ++i) {
    minPosition[0] = Math.min(minPosition[0], positions[3 * i + 0] - padding);
    minPosition[1] = Math.min(minPosition[1], positions[3 * i + 1] - padding);
    minPosition[2] = Math.min(minPosition[2], positions[3 * i + 2] - padding);
    maxPosition[0] = Math.max(maxPosition[0], positions[3 * i + 0] + padding);
    maxPosition[1] = Math.max(maxPosition[1], positions[3 * i + 1] + padding);
    maxPosition[2] = Math.max(maxPosition[2], positions[3 * i + 2] + padding);
  }

  indices.set( pole ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]);

  var buffer = Buffer.concat([
    Buffer.from(indices.buffer), 
    Buffer.from(normals.buffer), 
    Buffer.from(positions.buffer)
  ], indices.byteLength + normals.byteLength + positions.byteLength);
  
  // https://github.com/KhronosGroup/glTF/tree/master/specification/1.0/schema
  var gltf = {
    accessors: {
      accessor_ind: {
        bufferView: "bufferView_ind",
        byteOffset: 0,
        byteStride: 0,
        componentType: 5123, // UNSIGNED_SHORT
        count: indexCount,
        type: "SCALAR"
      },
      accessor_nor: {
        bufferView: "bufferViews_attr",
        byteOffset: 0,
        byteStride: 0,
        componentType: 5126, // FLOAT
        count: vertexCount,
        max: [1, 1, 1],
        min: [-1, -1, -1],
        type: "VEC3"
      },
      accessor_pos: {
        bufferView: "bufferViews_attr",
        byteOffset: componentBytes * vertexCount,
        byteStride: 0,
        componentType: 5126, // FLOAT
        count: vertexCount,
        max: minPosition,
        min: maxPosition,
        type: "VEC3"
      }
    },
    asset: {
      premultipliedAlpha: true,
      profile: {
        api: "WebGL",
        version: "1.0.2"
      },
      version: "1.0"
    },
    bufferViews: {
      bufferView_ind: {
        buffer: "Terrain",
        byteLength: indices.byteLength,
        byteOffset: 0,
        target: 34963 // ELEMENT_ARRAY_BUFFER 
      },
      bufferViews_attr: {
        buffer: "Terrain",
        byteLength: normals.byteLength + positions.byteLength,
        byteOffset: indices.byteLength,
        target: 34962 // ARRAY_BUFFER
      }
    },
    buffers: {
      Terrain: {
        byteLength: buffer.byteLength,
        type: "arraybuffer",
        uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`
      }
    },
    materials: {
      material_terrain: {
        name: "MaterialTerrain",
        technique: "technique_terrain",
        values: {
          diffuse: [ 0.8, 0.8, 0.8, 1]
        }
      }
    },
    meshes: {
      mesh_terrain: {
        name: "Terrain",
        primitives: [
          {
            attributes: {
              NORMAL: "accessor_nor",
              POSITION: "accessor_pos",
            },
            indices: "accessor_ind",
            material: "material_terrain",
            mode: 4 // triangles
          }
        ]
      }
    },
    nodes: {
      node_terrain: {
        children: [],
        matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
        meshes: [ "mesh_terrain" ],
        name: "Terrain"
      }
    },
    programs: {
      program_terrain: {
        attributes: [
          "a_normal",
          "a_position"
        ],
        fragmentShader: 'terrainFS',
        vertexShader: 'terrainVS'
      }
    },  
    scene: "defaultScene",
    scenes: {
      defaultScene: {
        nodes: [
          "node_terrain"
        ]
      }
    },
    shaders: {
      terrainFS: {
        type: 35632,
        uri: "shaders/terrainFS.glsl"
      },
      terrainVS: {
        type: 35633,
        uri: "shaders/terrainVS.glsl"
      }
    },
    techniques: {
      technique_terrain: {
        attributes: {
          a_normal: "normal",
          a_position: "position"
        },
        parameters: {
          "diffuse": {
            "type": 35666
          },
          "modelViewMatrix": {
            "semantic": "MODELVIEW",
            "type": 35676
          },
          "normal": {
            "semantic": "NORMAL",
            "type": 35665
          },
          "normalMatrix": {
            "semantic": "MODELVIEWINVERSETRANSPOSE",
            "type": 35675
          },
          "position": {
            "semantic": "POSITION",
            "type": 35665
          },
          "projectionMatrix": {
            "semantic": "PROJECTION",
            "type": 35676
          },
        },
        program: "program_terrain",
        states: {
          enable: [
            2929, // DEPTH_TEST
            2884  // CULL_FACE
          ]
        },
        uniforms: {
          u_diffuse: "diffuse",
          u_modelViewMatrix: "modelViewMatrix",
          u_normalMatrix: "normalMatrix",
          u_projectionMatrix: "projectionMatrix",
        }
      }
    }
  };

  addCesiumRTC(gltf, {
    longitude: region[0],
    latitude: region[1],
    height: 0
  });

  const pipelineOptions = {
    basePath: __dirname,
    optimizeForCesium: true
  };

  return processJSON(gltf, pipelineOptions)
    .then(function(optimizedGltf) {
      var gltfWithExtras = addPipelineExtras(optimizedGltf);
      return loadGltfUris(gltfWithExtras);
    })
    .then(function(pipelineGltf) {
      var binaryGltf = getBinaryGltf(pipelineGltf, true, false);
      var glbBuffer = binaryGltf.glb;
      var b3dmBuffer = glbToB3dm(glbBuffer);
      return b3dmBuffer;
    });
}

module.exports = TerrainProvider;