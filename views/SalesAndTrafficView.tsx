import React, { useState, useMemo, useEffect, useCallback, useContext } from 'react';
import { SalesAndTrafficData, SPFilterOptions } from '../types';
import { formatNumber, formatPercent, formatPrice, getNested } from '../utils';
import { DataCacheContext } from '../contexts/DataCacheContext';

const styles: { [key: string]: React.CSSProperties } = {
    viewContainer: {
        padding: '20px',
        maxWidth: '100%', // Use full width
        margin: '0 auto',
    },
    header: {
        marginBottom: '20px',
    },
    title: {
        fontSize: '2rem',
        margin: '0 0 5px 0',
    },
    subtitle: {
        fontSize: '1rem',
        color: '#666',
        margin: 0,
    },
    card: {
        backgroundColor: 'var(--card-background-color)',
        borderRadius: 'var(--border-radius)',
        boxShadow: 'var(--box-shadow)',
        padding: '15px',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        flexWrap: 'wrap',
    },
    filterGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
    },
    label: {
        fontSize: '0.8rem',
        fontWeight: 500,
        color: '#333',
    },
    input: {
        padding: '8px 12px',
        borderRadius: '4px',
        border: '1px solid var(--border-color)',
        fontSize: '1rem',
    },
    select: {
        padding: '8px 12px',
        borderRadius: '4px',
        border: '1px solid var(--border-color)',
        fontSize: '1rem',
        minWidth: '200px',
    },
    primaryButton: {
        padding: '10px 20px',
        border: 'none',
        borderRadius: '4px',
        backgroundColor: 'var(--primary-color)',
        color: 'white',
        fontSize: '1rem',
        cursor: 'pointer',
        alignSelf: 'flex-end',
    },
    tableContainer: {
        backgroundColor: 'var(--card-background-color)',
        borderRadius: 'var(--border-radius)',
        boxShadow: 'var(--box-shadow)',
        overflowX: 'auto',
        marginTop: '20px',
    },
    table: {
        width: '100%',
        minWidth: '2800px', // Set a min-width to handle all columns
        borderCollapse: 'collapse',
    },
    th: {
        padding: '12px 15px',
        textAlign: 'left',
        borderBottom: '2px solid var(--border-color)',
        backgroundColor: '#f8f9fa',
        fontWeight: 600,
    },
    td: {
        padding: '12px 15px',
        borderBottom: '1px solid var(--border-color)',
        whiteSpace: 'nowrap',
    },
    message: {
        textAlign: 'center',
        padding: '50px',
        fontSize: '1.2rem',
        color: '#666',
    },
    error: {
        color: 'var(--danger-color)',
        padding: '20px',
        backgroundColor: '#fdd',
        borderRadius: 'var(--border-radius)',
        marginTop: '20px',
    },
    link: {
        textDecoration: 'none',
        color: 'var(--primary-color)',
        fontWeight: 500,
    },
};

export function SalesAndTrafficView() {
    const { cache, setCache } = useContext(DataCacheContext);

    const [filterOptions, setFilterOptions] = useState<SPFilterOptions>({ asins: [], dates: [] });

    const [selectedAsin, setSelectedAsin] = useState<string>(cache.salesAndTraffic.filters?.asin || '');
    const [selectedDate, setSelectedDate] = useState<string>(cache.salesAndTraffic.filters?.date || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 2); // Default to 2 days ago
        return d.toISOString().split('T')[0];
    })());
    
    const [salesData, setSalesData] = useState<SalesAndTrafficData[]>(cache.salesAndTraffic.data || []);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasAppliedFilters, setHasAppliedFilters] = useState(!!cache.salesAndTraffic.filters);
    const [sortConfig, setSortConfig] = useState<{ key: string | null; direction: 'ascending' | 'descending' }>({ key: 'sessions', direction: 'descending' });

     useEffect(() => {
        const fetchFilters = async () => {
            if (filterOptions.asins.length > 0) return;
            try {
                setError(null);
                setLoading(true);
                const response = await fetch('/api/sales-and-traffic-filters');
                if (!response.ok) {
                     const errorData = await response.json().catch(() => ({ error: 'Failed to fetch filter options.' }));
                     throw new Error(errorData.error);
                }
                const data: SPFilterOptions = await response.json();
                setFilterOptions(data);
            } catch (e) {
                if (e instanceof Error) setError(e.message);
                else setError('An unknown error occurred.');
            } finally {
                setLoading(false);
            }
        };
        fetchFilters();
    }, [filterOptions.asins.length]);

    const handleApply = useCallback(async () => {
        if (!selectedDate) return;

        const currentFilters = { asin: selectedAsin, date: selectedDate };
        // Check cache first
        if (
            JSON.stringify(cache.salesAndTraffic.filters) === JSON.stringify(currentFilters) &&
            cache.salesAndTraffic.data.length > 0
        ) {
            setSalesData(cache.salesAndTraffic.data);
            setHasAppliedFilters(true);
            return; // Skip fetch
        }

        try {
            setHasAppliedFilters(true);
            setLoading(true);
            setError(null);
            let url = `/api/sales-and-traffic?date=${encodeURIComponent(selectedDate)}`;
            if (selectedAsin) url += `&asin=${encodeURIComponent(selectedAsin)}`;
            const response = await fetch(url);
            if (!response.ok) {
                 const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            const fetchedData: SalesAndTrafficData[] = await response.json();
            setSalesData(fetchedData);
            // Update cache
            setCache(prev => ({
                ...prev,
                salesAndTraffic: {
                    data: fetchedData,
                    filters: currentFilters
                }
            }));
        } catch (e) {
            if (e instanceof Error) setError(`Failed to fetch data: ${e.message}`);
            else setError('An unknown error occurred.');
            setSalesData([]);
        } finally {
            setLoading(false);
        }
    }, [selectedAsin, selectedDate, cache.salesAndTraffic, setCache]);

    const requestSort = (key: string) => {
        let direction: 'ascending' | 'descending' = 'descending';
        if (sortConfig.key === key && sortConfig.direction === 'descending') {
            direction = 'ascending';
        }
        setSortConfig({ key, direction });
    };

    const sortedSalesData = useMemo(() => {
        let sortableItems = [...salesData];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                const aValue = getNested(a, sortConfig.key!);
                const bValue = getNested(b, sortConfig.key!);
                if (aValue === null || aValue === undefined) return 1;
                if (bValue === null || bValue === undefined) return -1;
                if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [salesData, sortConfig]);
    
    // Comprehensive column definitions
    const columns = [
        // IDs
        { id: 'childAsin', label: 'Child ASIN' },
        { id: 'sku', label: 'SKU' },
        // Main Sales
        { id: 'orderedProductSales', label: 'Ordered Sales', format: formatPrice },
        { id: 'unitsOrdered', label: 'Units Ordered', format: formatNumber },
        { id: 'totalOrderItems', label: 'Total Items', format: formatNumber },
        { id: 'averageSalesPerOrderItem', label: 'Avg Sale/Item', format: formatPrice },
        // Main Traffic
        { id: 'sessions', label: 'Sessions', format: formatNumber },
        { id: 'pageViews', label: 'Page Views', format: formatNumber },
        { id: 'unitSessionPercentage', label: 'Unit Session %', format: formatPercent },
        { id: 'sessionPercentage', label: 'Session %', format: formatPercent },
        { id: 'pageViewsPercentage', label: 'Page View %', format: formatPercent },
        { id: 'buyBoxPercentage', label: 'Buy Box %', format: formatPercent },
        // B2B Sales
        { id: 'orderedProductSalesB2B', label: 'Sales (B2B)', format: formatPrice },
        { id: 'unitsOrderedB2B', label: 'Units (B2B)', format: formatNumber },
        { id: 'totalOrderItemsB2B', label: 'Items (B2B)', format: formatNumber },
        { id: 'averageSalesPerOrderItemB2B', label: 'Avg Sale/Item (B2B)', format: formatPrice },
        // B2B Traffic
        { id: 'sessionsB2B', label: 'Sessions (B2B)', format: formatNumber },
        { id: 'pageViewsB2B', label: 'Page Views (B2B)', format: formatNumber },
        { id: 'unitSessionPercentageB2B', label: 'Unit Session % (B2B)', format: formatPercent },
        { id: 'buyBoxPercentageB2B', label: 'Buy Box % (B2B)', format: formatPercent },
        // Device Traffic
        { id: 'browserSessions', label: 'Browser Sessions', format: formatNumber },
        { id: 'mobileAppSessions', label: 'Mobile Sessions', format: formatNumber },
        { id: 'browserPageViews', label: 'Browser Views', format: formatNumber },
        { id: 'mobileAppPageViews', label: 'Mobile Views', format: formatNumber },
    ].map(c => ({...c, sortable: c.id !== 'childAsin'})); // Make all metric columns sortable


    const renderContent = () => {
        if (loading) return <div style={styles.message}>Loading data...</div>;
        if (error) return null;
        if (!hasAppliedFilters) return <div style={styles.message}>Please select filters and click "Apply" to view data.</div>;
        if (sortedSalesData.length === 0) return <div style={styles.message}>No data available for the selected filters.</div>;

        return (
             <table style={styles.table}>
                <thead>
                    <tr>
                        {columns.map(col => (
                             <th key={col.id} style={{...styles.th, cursor: col.sortable ? 'pointer' : 'default'}} onClick={() => col.sortable && requestSort(col.id)}>
                                {col.label} {sortConfig.key === col.id ? (sortConfig.direction === 'ascending' ? '▲' : '▼') : ''}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sortedSalesData.map((item, index) => (
                        <tr key={`${item.childAsin}-${item.sku}-${index}`}>
                            {columns.map(col => (
                                 <td key={col.id} style={styles.td}>
                                    {col.id === 'childAsin' ? (
                                        <a href={`https://www.amazon.com/dp/${item.childAsin}`} target="_blank" rel="noopener noreferrer" style={styles.link}>
                                            {item.childAsin}
                                        </a>
                                    ) : (
                                        col.format ? col.format(getNested(item, col.id)) : getNested(item, col.id)
                                    )}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    };

    const filtersDisabled = loading || !!error;

    return (
        <div style={styles.viewContainer}>
            <header style={styles.header}>
                <h1 style={styles.title}>Sales & Traffic</h1>
                <p style={styles.subtitle}>View detailed daily sales and traffic metrics for your products.</p>
            </header>
            <div style={styles.card}>
                <div style={styles.filterGroup}>
                    <label style={styles.label} htmlFor="asin-select-sales">ASIN</label>
                    <select id="asin-select-sales" style={styles.select} value={selectedAsin} onChange={e => setSelectedAsin(e.target.value)} disabled={filtersDisabled || filterOptions.asins.length === 0}>
                        <option value="">All ASINs</option>
                        {filterOptions.asins.map(asin => <option key={asin} value={asin}>{asin}</option>)}
                    </select>
                </div>
                <div style={styles.filterGroup}>
                    <label style={styles.label} htmlFor="date-select-sales">Select day</label>
                    <input type="date" id="date-select-sales" style={styles.input} value={selectedDate} onChange={e => setSelectedDate(e.target.value)} disabled={filtersDisabled} />
                </div>
                <button onClick={handleApply} style={styles.primaryButton} disabled={filtersDisabled || !selectedDate}>
                    {loading ? 'Applying...' : 'Apply'}
                </button>
            </div>
            
            {error && <div style={styles.error}>{error}</div>}
            
            <div style={styles.tableContainer}>
                {renderContent()}
            </div>
        </div>
    );
}