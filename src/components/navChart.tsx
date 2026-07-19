/** Dependency-free NAV line chart — month-end points joined by rotated
 *  segments (plain Views, no SVG/native chart lib), in the "data-dense but
 *  calm" language of spec §10. */
import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { money } from '@/lib/format';

const CHART_HEIGHT = 96;
const DOT = 5;
const STROKE = 2;

export function NavChart({
  points,
  currency,
}: {
  points: { date: string; totalMinor: number }[];
  currency: string;
}) {
  const [width, setWidth] = React.useState(0);

  if (points.length === 0) return null;
  const values = points.map((p) => p.totalMinor);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(max - min, 1);
  const first = points[0];
  const last = points[points.length - 1];

  const flat = max === min;
  const xy = (i: number): { x: number; y: number } => ({
    x: points.length === 1 ? width / 2 : (i / (points.length - 1)) * width,
    // A genuinely flat series reads better centered than pinned to an edge.
    y: flat
      ? CHART_HEIGHT / 2
      : CHART_HEIGHT - ((points[i].totalMinor - min) / span) * (CHART_HEIGHT - DOT) - DOT / 2,
  });

  // Axis gridlines: max / mid / min of the range (one center line when flat).
  const ticks = flat
    ? [{ value: max, y: CHART_HEIGHT / 2 }]
    : [max, (max + min) / 2, min].map((value) => ({
        value,
        y: CHART_HEIGHT - ((value - min) / span) * (CHART_HEIGHT - DOT) - DOT / 2,
      }));

  return (
    <View className="gap-2">
      <View
        style={{ height: CHART_HEIGHT }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {ticks.map((t) => (
          <React.Fragment key={`tick-${t.value}`}>
            <View
              className="absolute left-0 right-0 bg-border"
              style={{ height: 1, top: t.y }}
            />
            <Text
              variant="muted"
              className="absolute right-0 font-mono text-[10px]"
              style={{ top: t.y - 14 }}>
              {money(t.value, currency, { compact: true })}
            </Text>
          </React.Fragment>
        ))}
        {width > 0
          ? points.slice(0, -1).map((p, i) => {
              const a = xy(i);
              const b = xy(i + 1);
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const length = Math.hypot(dx, dy);
              const angle = Math.atan2(dy, dx);
              return (
                <View
                  key={`seg-${p.date}`}
                  className="absolute rounded-full bg-primary"
                  style={{
                    width: length,
                    height: STROKE,
                    left: (a.x + b.x) / 2 - length / 2,
                    top: (a.y + b.y) / 2 - STROKE / 2,
                    transform: [{ rotate: `${angle}rad` }],
                  }}
                />
              );
            })
          : null}
        {width > 0 ? (
          // Endpoint dot — the "now" marker.
          <View
            className="absolute rounded-full bg-primary"
            style={{
              width: DOT,
              height: DOT,
              left: xy(points.length - 1).x - DOT / 2,
              top: xy(points.length - 1).y - DOT / 2,
            }}
          />
        ) : null}
      </View>
      <View className="flex-row justify-between">
        <Text variant="muted" className="font-mono text-xs">
          {first.date.slice(0, 7)} · {money(first.totalMinor, currency, { compact: true })}
        </Text>
        <Text variant="muted" className="font-mono text-xs">
          {last.date.slice(0, 7)} · {money(last.totalMinor, currency, { compact: true })}
        </Text>
      </View>
    </View>
  );
}
