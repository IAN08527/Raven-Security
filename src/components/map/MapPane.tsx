export function MapPane() {
  return (
    <div className="flex h-full items-center justify-center bg-pd-base text-pd-text-secondary">
      <div className="text-center">
        <div className="text-pd-lg">Geospatial Routine Map</div>
        <div className="mt-1 text-pd-sm">
          MapLibre GL + local PMTiles basemap (offline, per D6)
        </div>
      </div>
    </div>
  );
}
