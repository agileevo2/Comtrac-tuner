import React, { useState, useMemo } from 'react';
import { ArrowLeft, Activity, Database, Settings, AlertTriangle, ToggleLeft, ToggleRight } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Line, ReferenceDot } from 'recharts';

function FieldPortalDashboard({ well, run, onBack, onTogglePortal }) {
    const [portalEnabled, setPortalEnabled] = useState(run.fieldPortalEnabled !== false);

    const handleToggle = async () => {
        const newState = !portalEnabled;
        setPortalEnabled(newState);
        if (onTogglePortal) {
            await onTogglePortal(run.id, newState);
        }
    };

    // Calculate chart data with pressure adjustment
    const chartData = useMemo(() => {
        if (!run.simulations?.chartData) return [];
        if (!run.pressureAdjustment?.enabled) return run.simulations.chartData;

        const rodDiameter = run.rod?.diameter || 0;
        const rodArea = Math.PI * Math.pow((rodDiameter / 100 / 2), 2);
        const originalWHP = run.fluids?.whp || 0;
        const pressureDiff = ((run.pressureAdjustment.adjustedWHP || 0) - originalWHP) * 100000;
        const forceOffsetN = pressureDiff * rodArea;
        const weightOffsetKg = forceOffsetN / 9.81;

        return run.simulations.chartData.map(d => ({
            ...d,
            rih_standard_1: d.rih_standard_1 !== null ? d.rih_standard_1 + weightOffsetKg : null,
            rih_standard_2: d.rih_standard_2 !== null ? d.rih_standard_2 + weightOffsetKg : null,
            rih_tractor: d.rih_tractor !== null ? d.rih_tractor + weightOffsetKg : null,
            pooh: d.pooh !== null ? d.pooh + weightOffsetKg : null
        }));
    }, [run.simulations?.chartData, run.pressureAdjustment, run.fluids?.whp, run.rod?.diameter]);

    const pickupWeights = run.pickupWeights || [];
    const pressureAdj = run.pressureAdjustment || {};

    // Portal OFF state
    if (!portalEnabled) {
        return (
            <div className="max-w-6xl mx-auto">
                <div className="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200">
                    {/* Header */}
                    <div className="bg-[#37424A] text-white p-6 flex items-center justify-between">
                        <button onClick={onBack} className="flex items-center gap-2 hover:text-[#FFC82E] transition">
                            <ArrowLeft size={20} />
                            <span>Tilbake</span>
                        </button>
                        <h1 className="text-2xl font-bold">Feltingeniørportal - {run.bha?.name || 'Uten navn'}</h1>
                        <div className="w-24"></div>
                    </div>

                    {/* Toggle */}
                    <div className="p-6 border-b bg-gray-50">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-gray-600">Portal Status:</span>
                            <button
                                onClick={handleToggle}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg transition bg-gray-200 hover:bg-gray-300"
                            >
                                <ToggleLeft size={24} className="text-gray-600" />
                                <span className="text-sm font-bold">AV</span>
                            </button>
                        </div>
                    </div>

                    {/* Unavailable Message */}
                    <div className="p-12">
                        <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-8 text-center">
                            <AlertTriangle size={48} className="mx-auto mb-4 text-yellow-600" />
                            <h2 className="text-2xl font-bold text-yellow-800 mb-3">Feltingeniørportalen er ikke tilgjengelig</h2>
                            <p className="text-yellow-700 text-lg">
                                Aktiver portalen for å se sanntidsdata, pickup-vekter og trykkjusteringer.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Portal ON state
    return (
        <div className="max-w-6xl mx-auto">
            <div className="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200">
                {/* Header */}
                <div className="bg-[#37424A] text-white p-6 flex items-center justify-between">
                    <button onClick={onBack} className="flex items-center gap-2 hover:text-[#FFC82E] transition">
                        <ArrowLeft size={20} />
                        <span>Tilbake</span>
                    </button>
                    <div className="text-center">
                        <h1 className="text-2xl font-bold">{well.name}</h1>
                        <h2 className="text-lg text-[#FFC82E]">{run.bha?.name || 'Uten navn'}</h2>
                    </div>
                    <div className="w-24"></div>
                </div>

                {/* Toggle */}
                <div className="p-4 border-b bg-gray-50">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-gray-600">Portal Status:</span>
                        <button
                            onClick={handleToggle}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg transition bg-[#37424A] hover:bg-[#2c353b]"
                        >
                            <ToggleRight size={24} className="text-[#FFC82E]" />
                            <span className="text-sm font-bold text-white">PÅ</span>
                        </button>
                    </div>
                </div>

                {/* Chart */}
                <div className="p-6 border-b">
                    <h3 className="font-bold text-[#37424A] mb-4 flex items-center gap-2">
                        <Activity size={18} /> Surface Weight vs MD
                        {pressureAdj.enabled && (
                            <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded border border-red-200 font-normal ml-2">
                                Justert for trykk
                            </span>
                        )}
                    </h3>

                    {pressureAdj.enabled && (
                        <div className="mb-4 bg-red-50 border-l-4 border-red-500 p-3 rounded-r">
                            <div className="flex items-start">
                                <AlertTriangle className="text-red-500 mr-2 mt-0.5" size={18} />
                                <div className="text-sm text-red-700">
                                    <strong>Grafen er justert!</strong> Trykkjustering er aktivert.
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="h-[500px] w-full bg-white rounded border border-gray-200 p-4">
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                                    <XAxis
                                        dataKey="md"
                                        type="number"
                                        domain={[0, 'auto']}
                                        ticks={Array.from({ length: Math.ceil((chartData[chartData.length - 1]?.md || 8000) / 100) + 1 }, (_, i) => i * 100)}
                                        label={{ value: 'MD (m)', position: 'insideBottom', offset: -10, style: { fill: '#6B7280', fontSize: 12 } }}
                                        tick={{ fontSize: 10, fill: '#6B7280' }}
                                    />
                                    <YAxis
                                        ticks={Array.from({ length: 41 }, (_, i) => i * 100 - 1000)}
                                        domain={['auto', 'auto']}
                                        label={{ value: 'Surface Weight (kg)', angle: -90, position: 'insideLeft', style: { fill: '#6B7280', fontSize: 12 } }}
                                        tick={{ fontSize: 10, fill: '#6B7280' }}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)', borderRadius: '4px', border: '1px solid #E5E7EB', fontSize: '12px' }}
                                        itemStyle={{ padding: 0 }}
                                    />
                                    <Legend verticalAlign="top" height={36} iconType="plainline" wrapperStyle={{ fontSize: '12px' }} />
                                    <Line type="monotone" dataKey="rih_standard_1" stroke="#1E40AF" name="RIH (Standard)" dot={false} strokeWidth={2} connectNulls />
                                    <Line type="monotone" dataKey="rih_tractor" stroke="#1E40AF" strokeDasharray="5 5" name="RIH (Tractor)" dot={false} strokeWidth={2} connectNulls />
                                    <Line type="monotone" dataKey="rih_standard_2" stroke="#1E40AF" name="RIH (Standard)" dot={false} strokeWidth={2} connectNulls legendType="none" />
                                    <Line type="monotone" dataKey="pooh" stroke="#10B981" name="POOH" dot={false} strokeWidth={2} connectNulls />
                                    {/* Pickup weights */}
                                    {pickupWeights.map((pw, i) => (
                                        <ReferenceDot key={i} x={pw.md} y={pw.weight} r={5} fill="#EF4444" stroke="#991B1B" strokeWidth={2} />
                                    ))}
                                </ComposedChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-400">Ingen simuleringsdata tilgjengelig</div>
                        )}
                    </div>
                </div>

                {/* Pickup Weights */}
                {pickupWeights.length > 0 && (
                    <div className="p-6 border-b">
                        <h3 className="font-bold text-[#37424A] mb-4 flex items-center gap-2">
                            <Database size={18} /> Pickup Vekter (RIG)
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border">
                                <thead className="bg-gray-100 text-xs text-gray-500 uppercase">
                                    <tr>
                                        <th className="p-2 text-left">MD (m)</th>
                                        <th className="p-2 text-left">Vekt (kg)</th>
                                        <th className="p-2 text-left">Type</th>
                                        <th className="p-2 text-left">Avvik (kg)</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white">
                                    {pickupWeights.map((pw, i) => {
                                        const simData = chartData.find(d => Math.abs(d.md - pw.md) < 50) || {};
                                        const simValue = pw.type === 'RIH' ? (simData.rih_standard_1 || simData.rih_standard_2 || simData.rih_tractor) : simData.pooh;
                                        const deviation = simValue !== null && simValue !== undefined ? pw.weight - simValue : null;

                                        return (
                                            <tr key={i} className="border-b last:border-0">
                                                <td className="p-2 font-medium">{pw.md}</td>
                                                <td className="p-2">{pw.weight}</td>
                                                <td className="p-2">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${pw.type === 'RIH' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                                                        {pw.type}
                                                    </span>
                                                </td>
                                                <td className="p-2">
                                                    {deviation !== null ? (
                                                        <span className={`font-bold ${Math.abs(deviation) > 50 ? 'text-red-600' : 'text-green-600'}`}>
                                                            {deviation > 0 ? '+' : ''}{deviation.toFixed(1)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400">-</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Pressure Adjustment Info */}
                {pressureAdj.enabled && (
                    <div className="p-6">
                        <h3 className="font-bold text-[#37424A] mb-4 flex items-center gap-2">
                            <Settings size={18} /> Trykkjustering
                        </h3>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                    <div className="text-gray-500 text-xs font-bold uppercase mb-1">Original WHP</div>
                                    <div className="font-bold text-[#37424A]">{run.fluids?.whp || 0} bar</div>
                                </div>
                                <div>
                                    <div className="text-gray-500 text-xs font-bold uppercase mb-1">Justert WHP</div>
                                    <div className="font-bold text-blue-600">{pressureAdj.adjustedWHP || 0} bar</div>
                                </div>
                                <div>
                                    <div className="text-gray-500 text-xs font-bold uppercase mb-1">Vekt-offset</div>
                                    <div className="font-bold text-blue-600">
                                        {(() => {
                                            const rodDiameter = run.rod?.diameter || 0;
                                            const rodArea = Math.PI * Math.pow((rodDiameter / 100 / 2), 2);
                                            const originalWHP = run.fluids?.whp || 0;
                                            const pressureDiff = ((pressureAdj.adjustedWHP || 0) - originalWHP) * 100000;
                                            const forceOffsetN = pressureDiff * rodArea;
                                            const weightOffsetKg = forceOffsetN / 9.81;
                                            return `${weightOffsetKg > 0 ? '+' : ''}${weightOffsetKg.toFixed(1)} kg`;
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default FieldPortalDashboard;
