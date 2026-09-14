import type { GraphEntityType } from "../../types/api";
import type { DateRange } from "./EdgeEvidencePanel";

export interface GraphFilters {
  types: GraphEntityType[];
  minWeight: number;
  dateRange: DateRange;
  isolate: boolean;
}

export const DEFAULT_FILTERS: GraphFilters = {
  types: ["PERSON"], // D23: person-to-person unless explicitly expanded
  minWeight: 0,
  dateRange: { from: "", to: "" },
  isolate: false,
};

const ALL_TYPES: GraphEntityType[] = ["PERSON", "ORGANIZATION", "ACCOUNT", "LOCATION", "VEHICLE"];

interface GraphFilterPanelProps {
  filters: GraphFilters;
  isolateAvailable: boolean;
  resultCount: { nodes: number; edges: number };
  onChange: (filters: GraphFilters) => void;
}

/**
 * M4-T5. Filter panel: entity-type toggles, weight floor, date range,
 * neighbourhood isolation. Every change re-queries through the parent
 * (which owns fetching); the panel itself never touches the cached
 * layout positions.
 */
export function GraphFilterPanel({
  filters,
  isolateAvailable,
  resultCount,
  onChange,
}: GraphFilterPanelProps): JSX.Element {
  const toggleType = (type: GraphEntityType): void => {
    const active = filters.types.includes(type);
    const types = active ? filters.types.filter((t) => t !== type) : [...filters.types, type];
    onChange({ ...filters, types });
  };
  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto bg-[#1B1B19] p-3 text-xs">
      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
          Entity types
        </h4>
        <div className="flex flex-col gap-1.5">
          {ALL_TYPES.map((type) => (
            <label key={type} className="flex cursor-pointer items-center gap-2 text-[#E8E5DD]">
              <input
                type="checkbox"
                checked={filters.types.includes(type)}
                onChange={() => toggleType(type)}
                className="accent-[#668DBA]"
              />
              {type}
            </label>
          ))}
        </div>
      </section>
      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
          Minimum weight · {filters.minWeight}
        </h4>
        <input
          type="range"
          min={0}
          max={50}
          step={0.5}
          value={filters.minWeight}
          onChange={(event) => onChange({ ...filters, minWeight: Number(event.target.value) })}
          className="w-full accent-[#668DBA]"
          aria-label="Minimum edge weight"
        />
      </section>
      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
          Date range
        </h4>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center justify-between gap-2 text-[#A5A29A]">
            From
            <input
              type="date"
              value={filters.dateRange.from}
              onChange={(event) =>
                onChange({ ...filters, dateRange: { ...filters.dateRange, from: event.target.value } })
              }
              className="rounded-sm border border-[#30302D] bg-[#171716] px-1.5 py-1 text-[#E8E5DD]"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[#A5A29A]">
            To
            <input
              type="date"
              value={filters.dateRange.to}
              onChange={(event) =>
                onChange({ ...filters, dateRange: { ...filters.dateRange, to: event.target.value } })
              }
              className="rounded-sm border border-[#30302D] bg-[#171716] px-1.5 py-1 text-[#E8E5DD]"
            />
          </label>
        </div>
      </section>
      <section>
        <label className="flex cursor-pointer items-center gap-2 text-[#E8E5DD]">
          <input
            type="checkbox"
            checked={filters.isolate}
            disabled={!isolateAvailable}
            onChange={(event) => onChange({ ...filters, isolate: event.target.checked })}
            className="accent-[#668DBA]"
          />
          Isolate 1-hop neighbourhood
        </label>
        {!isolateAvailable && (
          <p className="mt-1 text-[11px] text-[#706E68]">Select a node first</p>
        )}
      </section>
      <p className="mt-auto text-[11px] text-[#706E68]">
        {resultCount.nodes} nodes · {resultCount.edges} edges
      </p>
    </div>
  );
}
