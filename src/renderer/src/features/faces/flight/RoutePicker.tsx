import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { searchAirports, type Airport } from "./airports";
import "./flight.css";

export interface FlightRouteValue {
  dep: string;
  arr: string;
}

export function FlightRoutePicker(props: {
  dep: string;
  arr: string;
  onChange?: (next: FlightRouteValue) => void;
  disabled?: boolean;
  layout: "settings" | "face";
  forceOpen?: "dep" | "arr" | null;
}): JSX.Element {
  const [open, setOpen] = useState<"dep" | "arr" | null>(props.forceOpen ?? null);

  useEffect(() => {
    if (props.forceOpen) {
      setOpen(props.forceOpen);
    }
  }, [props.forceOpen]);

  function commit(next: FlightRouteValue): void {
    if (next.dep === next.arr) {
      return;
    }
    props.onChange?.(next);
    setOpen(null);
  }

  return (
    <div
      className={["fp-flight-route", `is-${props.layout}`].join(" ")}
      data-flight-route={props.layout}
    >
      <AirportField
        id={`flight-dep-${props.layout}`}
        label="Origin"
        code={props.dep}
        otherCode={props.arr}
        open={open === "dep"}
        disabled={props.disabled}
        onToggle={() => setOpen((current) => (current === "dep" ? null : "dep"))}
        onPick={(code) => commit({ dep: code, arr: props.arr })}
      />
      <span className="fp-flight-route-arrow" aria-hidden="true">
        →
      </span>
      <AirportField
        id={`flight-arr-${props.layout}`}
        label="Arrival"
        code={props.arr}
        otherCode={props.dep}
        open={open === "arr"}
        disabled={props.disabled}
        onToggle={() => setOpen((current) => (current === "arr" ? null : "arr"))}
        onPick={(code) => commit({ dep: props.dep, arr: code })}
      />
    </div>
  );
}

function AirportField(props: {
  id: string;
  label: string;
  code: string;
  otherCode: string;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onPick: (code: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const matches = useMemo(
    () => searchAirports(query).filter((row) => row.code !== props.otherCode),
    [query, props.otherCode],
  );

  useEffect(() => {
    if (props.open) {
      setQuery("");
      inputRef.current?.focus();
    }
  }, [props.open]);

  return (
    <div className={`fp-flight-airport${props.open ? " is-open" : ""}`}>
      <span className="fp-flight-airport-label">{props.label}</span>
      <button
        type="button"
        className="fp-flight-airport-btn"
        aria-expanded={props.open}
        aria-controls={props.id}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        <b>{props.code}</b>
        <span>{cityName(props.code)}</span>
      </button>
      {props.open ? (
        <div className="fp-flight-airport-pop" id={props.id} role="listbox" aria-label={props.label}>
          <input
            ref={inputRef}
            value={query}
            placeholder="Search city or IATA"
            aria-label={`Search ${props.label.toLowerCase()}`}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul>
            {matches.length === 0 ? (
              <li className="is-empty">No curated airport matches</li>
            ) : (
              matches.map((row) => (
                <li key={row.code}>
                  <button type="button" onClick={() => props.onPick(row.code)}>
                    <b>{row.code}</b>
                    <span>{row.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function cityName(code: string): string {
  const hit = searchAirports(code).find((row: Airport) => row.code === code);
  return hit?.name ?? code;
}
