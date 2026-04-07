export function toApiSceneObject(sceneObject) {
  return {
    id: String(sceneObject?.id || ""),
    furniture_id: String(sceneObject?.furnitureId || sceneObject?.furniture_id || ""),
    x: Number(sceneObject?.x),
    y: Number(sceneObject?.y),
    scale: Number(sceneObject?.scale ?? 1),
    rotation_deg: Number(sceneObject?.rotationDeg ?? sceneObject?.rotation_deg ?? 0),
    layer_order: Number(sceneObject?.layerOrder ?? sceneObject?.layer_order ?? 0),
  };
}

export function toApiSceneObjects(sceneObjects) {
  return (Array.isArray(sceneObjects) ? sceneObjects : []).map(toApiSceneObject);
}
