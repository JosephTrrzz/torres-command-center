"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import signatureStyles from "./signature-loader.module.css";

export type SkeletonKind =
  | "block"
  | "line"
  | "circle"
  | "metric"
  | "chart"
  | "table"
  | "cards"
  | "activity"
  | "profile"
  | "messages"
  | "details"
  | "settings"
  | "calendar"
  | "documents"
  | "invoices"
  | "search";

export type PageSkeletonVariant =
  | "dashboard"
  | "clients"
  | "crm"
  | "projects"
  | "operations"
  | "inbox"
  | "campaigns"
  | "reports"
  | "settings"
  | "calendar";

export const LOADING_TIMING = {
  delay: 180,
  minimumVisible: 360,
  longWait: 1500,
} as const;

const APP_ENTRY_SESSION_KEY = "torres-os-signature-entry-seen";
let appEntrySeenInMemory = false;

export function shouldShowSignatureEntry() {
  if (appEntrySeenInMemory) return false;
  try {
    return window.sessionStorage.getItem(APP_ENTRY_SESSION_KEY) !== "true";
  } catch {
    return true;
  }
}

export function markSignatureEntrySeen() {
  appEntrySeenInMemory = true;
  try {
    window.sessionStorage.setItem(APP_ENTRY_SESSION_KEY, "true");
  } catch {
    // In-memory state still prevents repeat playback when storage is unavailable.
  }
}

export function useDelayedLoading(
  active: boolean,
  delay = LOADING_TIMING.delay,
  minimumVisible = LOADING_TIMING.minimumVisible,
) {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  const visibleRef = useRef(false);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (active) {
      timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delay);
    } else if (visibleRef.current) {
      const remaining = Math.max(0, minimumVisible - (Date.now() - shownAt.current));
      timer = setTimeout(() => setVisible(false), remaining);
    } else {
      setVisible(false);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [active, delay, minimumVisible]);

  return visible;
}

function useLongLoading(active: boolean, delay = LOADING_TIMING.longWait) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);

  return visible;
}

export function Skeleton({
  kind = "block",
  className = "",
}: {
  kind?: SkeletonKind;
  className?: string;
}) {
  return <span aria-hidden="true" className={`skeleton skeleton-${kind} ${className}`.trim()} />;
}

export function SkeletonText({ lines = 2 }: { lines?: number }) {
  return <span aria-hidden="true" className="skeleton-text">{Array.from({ length: lines }, (_, index) => <Skeleton className={index === lines - 1 ? "is-short" : ""} kind="line" key={index} />)}</span>;
}

export function MetricCardSkeleton({ count = 4 }: { count?: number }) {
  return <div aria-hidden="true" className="skeleton-metric-grid">{Array.from({ length: count }, (_, index) => <div className="skeleton-card skeleton-metric-card" key={index}><Skeleton className="skeleton-label" kind="line" /><Skeleton className="skeleton-number" kind="line" /><Skeleton className="skeleton-caption" kind="line" /></div>)}</div>;
}

export function ChartSkeleton() {
  return <div aria-hidden="true" className="skeleton-card skeleton-chart"><Skeleton className="skeleton-chart-title" kind="line" /><div className="skeleton-chart-frame">{[42, 66, 51, 78, 58, 72, 47].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div></div>;
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return <div aria-hidden="true" className="skeleton-card skeleton-table"><div className="skeleton-table-row is-heading"><Skeleton kind="line" /><Skeleton kind="line" /><Skeleton kind="line" /></div>{Array.from({ length: rows }, (_, index) => <div className="skeleton-table-row" key={index}><Skeleton kind="line" /><Skeleton kind="line" /><Skeleton kind="line" /></div>)}</div>;
}

export function CardGridSkeleton({ count = 3 }: { count?: number }) {
  return <div aria-hidden="true" className="skeleton-card-grid">{Array.from({ length: count }, (_, index) => <div className="skeleton-card skeleton-content-card" key={index}><div className="skeleton-card-heading"><Skeleton kind="circle" /><Skeleton className="skeleton-card-title" kind="line" /></div><SkeletonText lines={3} /></div>)}</div>;
}

export function ActivityFeedSkeleton({ rows = 4 }: { rows?: number }) {
  return <div aria-hidden="true" className="skeleton-card skeleton-activity">{Array.from({ length: rows }, (_, index) => <div key={index}><Skeleton kind="circle" /><span><Skeleton kind="line" /><Skeleton className="is-short" kind="line" /></span></div>)}</div>;
}

export function MessageSkeleton() {
  return <div aria-hidden="true" className="skeleton-card skeleton-messages"><Skeleton className="skeleton-message inbound" /><Skeleton className="skeleton-message outbound" /><Skeleton className="skeleton-message inbound is-short" /></div>;
}

export function DetailPanelSkeleton() {
  return <div aria-hidden="true" className="skeleton-card skeleton-details"><Skeleton className="skeleton-detail-kicker" kind="line" /><Skeleton className="skeleton-detail-title" kind="line" /><SkeletonText lines={3} /><div className="skeleton-detail-grid"><Skeleton /><Skeleton /></div></div>;
}

export function SettingsFormSkeleton() {
  return <div aria-hidden="true" className="skeleton-card skeleton-settings"><Skeleton className="skeleton-detail-title" kind="line" />{Array.from({ length: 4 }, (_, index) => <div key={index}><Skeleton className="skeleton-label" kind="line" /><Skeleton className="skeleton-input" /></div>)}</div>;
}

export function CalendarSkeleton() {
  return <div aria-hidden="true" className="skeleton-card skeleton-calendar"><div>{Array.from({ length: 7 }, (_, index) => <Skeleton kind="line" key={index} />)}</div><div>{Array.from({ length: 21 }, (_, index) => <Skeleton key={index} />)}</div></div>;
}

export function DocumentListSkeleton({ rows = 4 }: { rows?: number }) {
  return <div aria-hidden="true" className="skeleton-card skeleton-document-list">{Array.from({ length: rows }, (_, index) => <div key={index}><Skeleton className="skeleton-document-mark" /><span><Skeleton kind="line" /><Skeleton className="is-short" kind="line" /></span></div>)}</div>;
}

export function InvoiceListSkeleton() {
  return <TableSkeleton rows={3} />;
}

export function SearchResultsSkeleton() {
  return <ActivityFeedSkeleton rows={5} />;
}

export function ProfileSkeleton() {
  return <div aria-hidden="true" className="skeleton-card skeleton-profile"><Skeleton kind="circle" /><span><Skeleton kind="line" /><Skeleton className="is-short" kind="line" /></span></div>;
}

export function InlineLoader({ label = "Working" }: { label?: string }) {
  return <span className="inline-loader" role="status"><span aria-hidden="true" />{label}</span>;
}

export function ButtonLoader() {
  return <span aria-hidden="true" className="button-loader" />;
}

export function RefreshIndicator({ active, label = "Refreshing" }: { active: boolean; label?: string }) {
  return <span aria-live="polite" className={`refresh-indicator ${active ? "is-active" : ""}`}><span aria-hidden="true" />{active ? label : "Current"}</span>;
}

export type TorresLogoLoaderProps = {
  variant?: "dark" | "light";
  size?: "small" | "medium" | "large";
  status?: string;
  complete?: boolean;
  reducedMotion?: boolean;
  className?: string;
  error?: string;
  onRetry?: () => void;
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function TorresLogoLoader({
  variant = "dark",
  size = "medium",
  status = "Loading Torres OS",
  complete = false,
  reducedMotion,
  className = "",
  error,
  onRetry,
}: TorresLogoLoaderProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const reduceMotion = reducedMotion ?? prefersReducedMotion;
  const loaderClassName = [
    signatureStyles.loader,
    signatureStyles[variant],
    signatureStyles[size],
    className,
  ].filter(Boolean).join(" ");

  return (
    <div
      aria-busy={!complete && !error}
      aria-live="polite"
      className={loaderClassName}
      data-complete={complete || Boolean(error)}
      data-reduced-motion={reduceMotion}
      role={error ? "alert" : "status"}
    >
      <div aria-hidden="true" className={signatureStyles.mark}>
        <Image alt="" className={signatureStyles.outline} height={1024} priority src="/brand/torres-loader-mark.png" width={1024} />
        <span className={`${signatureStyles.fill} ${signatureStyles.blueFill}`}>
          <Image alt="" height={1024} priority src="/brand/torres-loader-blue.png" width={1024} />
        </span>
        <span className={`${signatureStyles.fill} ${signatureStyles.goldFill}`}>
          <Image alt="" height={1024} priority src="/brand/torres-loader-gold.png" width={1024} />
        </span>
        <span className={signatureStyles.lightPass} />
      </div>
      {error ? (
        <div className={signatureStyles.recovery}>
          <strong>Torres OS could not finish loading.</strong>
          <p>{error}</p>
          {onRetry ? <button onClick={onRetry} type="button">Try again</button> : null}
        </div>
      ) : <p className={signatureStyles.status}>{status}</p>}
    </div>
  );
}

export function AppEntryTransition({
  ready,
  children,
  variant = "dark",
  status = "Loading Torres OS",
  className = "",
}: {
  ready: boolean;
  children: React.ReactNode;
  variant?: "dark" | "light";
  status?: string;
  className?: string;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [showLoader, setShowLoader] = useState(!ready);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!ready) {
      setShowLoader(true);
    } else if (showLoader) {
      timer = setTimeout(() => setShowLoader(false), prefersReducedMotion ? 40 : 280);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [prefersReducedMotion, ready, showLoader]);

  return (
    <div className={`${signatureStyles.entry} ${className}`.trim()} data-ready={ready}>
      {showLoader ? (
        <div className={signatureStyles.entryLoader} data-complete={ready}>
          <TorresLogoLoader complete={ready} reducedMotion={prefersReducedMotion} status={status} variant={variant} />
        </div>
      ) : null}
      <div aria-hidden={!ready} className={signatureStyles.entryContent}>{children}</div>
    </div>
  );
}

export function BrandedAppLoader({
  label = "Opening your secure workspace",
  animate = false,
}: {
  label?: string;
  animate?: boolean;
}) {
  return <main className="branded-app-loader"><TorresLogoLoader reducedMotion={animate ? undefined : true} size="medium" status={label} variant="dark" /></main>;
}

export function ContentReveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`content-reveal ${className}`.trim()}>{children}</div>;
}

export function PageSkeleton({ variant = "dashboard" }: { variant?: PageSkeletonVariant }) {
  if (variant === "crm") return <><MetricCardSkeleton /><div className="skeleton-workspace-split"><ActivityFeedSkeleton /><DetailPanelSkeleton /></div></>;
  if (variant === "projects") return <><MetricCardSkeleton /><div className="skeleton-workspace-split"><CardGridSkeleton count={2} /><DetailPanelSkeleton /></div></>;
  if (variant === "operations") return <><MetricCardSkeleton count={6} /><div className="skeleton-workspace-split"><ActivityFeedSkeleton rows={3} /><CalendarSkeleton /></div></>;
  if (variant === "inbox") return <div className="skeleton-workspace-split skeleton-inbox"><ActivityFeedSkeleton rows={6} /><MessageSkeleton /></div>;
  if (variant === "campaigns") return <><MetricCardSkeleton count={3} /><div className="skeleton-workspace-split"><CardGridSkeleton count={2} /><DetailPanelSkeleton /></div></>;
  if (variant === "reports") return <><MetricCardSkeleton /><ChartSkeleton /><TableSkeleton /></>;
  if (variant === "settings") return <div className="skeleton-workspace-split"><ProfileSkeleton /><SettingsFormSkeleton /></div>;
  if (variant === "calendar") return <CalendarSkeleton />;
  if (variant === "clients") return <CardGridSkeleton count={3} />;
  return <><MetricCardSkeleton /><div className="skeleton-dashboard-grid"><ChartSkeleton /><ActivityFeedSkeleton /></div></>;
}

export function LoadingRegion({
  active,
  label,
  longWaitLabel = "Still preparing your workspace",
  variant = "dashboard",
}: {
  active: boolean;
  label: string;
  longWaitLabel?: string;
  variant?: PageSkeletonVariant;
}) {
  const visible = useDelayedLoading(active);
  const longWait = useLongLoading(active);
  return <section aria-busy={active} aria-live="polite" className={`loading-region ${visible ? "is-visible" : "is-pending"} ${longWait ? "is-long-wait" : ""}`}><span className="sr-only">{longWait ? longWaitLabel : label}</span>{visible ? <><PageSkeleton variant={variant} />{longWait ? <div className="loading-long-wait"><TorresLogoLoader size="small" status={longWaitLabel} variant="light" /></div> : null}</> : <div aria-hidden="true" className="loading-reserved-space" />}</section>;
}
