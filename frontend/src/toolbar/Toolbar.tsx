import { useEffect } from "react";
import { boardRegion } from "../regions/regions";
import { boardSize, fitCamera, zoomStep } from "../services/camera";
import { setMode } from "../services/mode";
import { getConnection } from "../services/previews";
import { loadScreens } from "../services/screens";
import { actions, getState, useStore } from "../store";

export function Toolbar() {
  const mode = useStore((s) => s.mode);
  const zoom = useStore((s) => s.camera.z);
  const menu = useStore((s) => s.menu);

  // Close menus on any click outside them.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-menu]")) actions.setMenu(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [menu]);

  return (
    <header className="toolbar">
      <div className="brand">
        <div className="brand-mark" />
        <span>Figr Viewer</span>
      </div>
      <div className="divider" />
      <div className="segmented" role="group" aria-label="Mode">
        <button aria-pressed={mode === "select"} onClick={() => setMode("select")}>
          Select <span className="kbd">V</span>
        </button>
        <button aria-pressed={mode === "interact"} onClick={() => setMode("interact")}>
          Interact <span className="kbd">I</span>
        </button>
      </div>
      <div className="spacer" />
      <div className="zoom">
        <button className="icon-btn" title="Zoom out (⌘ −)" onClick={() => zoomStep(boardSize().w, boardSize().h, 0.8)}>
          −
        </button>
        <button className="zoom-pct" title="Fit" onClick={() => fitCamera(boardSize().w, boardSize().h)}>
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn" title="Zoom in (⌘ +)" onClick={() => zoomStep(boardSize().w, boardSize().h, 1.25)}>
          +
        </button>
      </div>
      <div className="divider" />
      {import.meta.env.DEV && <DevMenu open={menu === "dev"} />}
      <ReportsMenu open={menu === "reports"} />
    </header>
  );
}

function ReportsMenu({ open }: { open: boolean }) {
  const reports = useStore((s) => s.reports);
  return (
    <div data-menu>
      <button className="menu-btn" aria-expanded={open} onClick={() => actions.setMenu(open ? null : "reports")}>
        Reports <span className={"count" + (reports.length ? " hot" : "")}>{reports.length}</span>
      </button>
      {open && (
        <div className="popover">
          <div className="popover-head">
            <b>report() calls</b>
            <span>one per failure · newest first</span>
          </div>
          {!reports.length && (
            <div className="empty" style={{ padding: "10px 8px 12px" }}>
              Nothing reported yet.
            </div>
          )}
          {reports.map((r) => (
            <div className="report-row" key={r.n}>
              <span className="n">#{r.n}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <b style={{ fontFamily: "var(--mono)" }}>{r.region}</b>
                  <span className="muted">
                    {r.screenId ?? "—"}
                    {r.elementKey ? ` · ${r.elementKey}` : ""}
                  </span>
                  <span className="n" style={{ marginLeft: "auto", fontSize: 11 }}>
                    {r.time}
                  </span>
                </div>
                <div className="msg">{r.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DevItem {
  label: string;
  hint: string;
  armed?: boolean;
  run: () => void;
}

function DevMenu({ open }: { open: boolean }) {
  const dev = useStore((s) => s.dev);
  const target = useStore((s) => s.active ?? s.screens[0]?.id ?? null);
  const targetName = useStore((s) => s.screens.find((x) => x.id === (s.active ?? s.screens[0]?.id))?.name ?? "—");

  const sections: { title: string; items: DevItem[] }[] = [
    {
      title: "API",
      items: [
        {
          label: "Fail /screens",
          hint: "board error",
          run: () => {
            actions.setDev((d) => void (d.failScreens = true));
            actions.setMenu(null);
            loadScreens();
          },
        },
        {
          label: "Slow + fail next details",
          hint: "2s → fail",
          armed: dev.detailsFail,
          run: () => actions.setDev((d) => void (d.detailsFail = !d.detailsFail)),
        },
        {
          label: "Race details",
          hint: "next 3 take 3s",
          armed: dev.race > 0,
          run: () => actions.setDev((d) => void (d.race = d.race > 0 ? 0 : 3)),
        },
        {
          label: "Throw when next details arrive",
          hint: "details region",
          armed: dev.throwOnDetails,
          run: () => actions.setDev((d) => void (d.throwOnDetails = !d.throwOnDetails)),
        },
      ],
    },
  ];

  if (target) {
    const sid = target;
    sections.push({
      title: `Preview · ${targetName}`,
      items: [
        {
          label: dev.broken[sid] ? "Unbreak preview" : "Break preview",
          hint: dev.broken[sid] ? "Retry recovers" : "no hello → 10s",
          armed: !!dev.broken[sid],
          run: () => actions.setDev((d) => void (d.broken[sid] = !d.broken[sid])),
        },
        {
          label: dev.silence[sid] ? "Unsilence bridge" : "Silence bridge",
          hint: "rows 3s · calls 10s",
          armed: !!dev.silence[sid],
          run: () => {
            const on = !getState().dev.silence[sid];
            actions.setDev((d) => void (d.silence[sid] = on));
            getConnection(sid)?.command("dev", { action: "silence", value: on });
          },
        },
        {
          label: dev.slow[sid] ? "Normal children" : "Slow children",
          hint: "getChildren 5s",
          armed: !!dev.slow[sid],
          run: () => {
            const on = !getState().dev.slow[sid];
            actions.setDev((d) => void (d.slow[sid] = on));
            getConnection(sid)?.command("dev", { action: "slowChildren", value: on ? 5000 : 0 });
          },
        },
        {
          label: "Page error",
          hint: "badge + 1 report",
          run: () => getConnection(sid)?.command("dev", { action: "throw" }),
        },
        {
          label: "Throw in message handler",
          hint: "on next message",
          armed: !!dev.throwMessage[sid],
          run: () => actions.setDev((d) => void (d.throwMessage[sid] = !d.throwMessage[sid])),
        },
      ],
    });
  }

  sections.push({
    title: "Regions",
    items: [
      {
        label: "Throw in inspector render",
        hint: "inspector only",
        run: () => actions.setDev((d) => void (d.throwInspector = true)),
      },
      {
        label: "Throw in layers key handler",
        hint: "on next arrow key",
        armed: dev.throwKey,
        run: () => actions.setDev((d) => void (d.throwKey = !d.throwKey)),
      },
      {
        label: "Throw in layers row click",
        hint: "on next row click",
        armed: dev.throwRowClick,
        run: () => actions.setDev((d) => void (d.throwRowClick = !d.throwRowClick)),
      },
      {
        label: "Throw in board timer",
        hint: "board region",
        run: () =>
          setTimeout(
            boardRegion.wrap(() => {
              throw new Error("Simulated throw in a board timer");
            }),
            0,
          ),
      },
    ],
  });

  return (
    <div data-menu>
      <button className="menu-btn" aria-expanded={open} onClick={() => actions.setMenu(open ? null : "dev")}>
        Dev
      </button>
      {open && (
        <div className="popover" style={{ width: 340, right: 108 }}>
          {sections.map((sec) => (
            <div className="dev-section" key={sec.title}>
              <div className="dev-title">{sec.title}</div>
              {sec.items.map((it) => (
                <button key={it.label} className="dev-item" onClick={it.run}>
                  <span>{it.label}</span>
                  <span className={"hint" + (it.armed ? " armed" : "")}>{it.armed ? "armed" : it.hint}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
