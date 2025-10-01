// views/ListingView.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ProductListing } from '../types';

const styles: { [key: string]: React.CSSProperties } = {
    container: { padding: '20px', maxWidth: '1200px', margin: '0 auto' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
    title: { fontSize: '2rem', margin: 0 },
    primaryButton: { padding: '10px 20px', backgroundColor: 'var(--primary-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem' },
    tableContainer: { backgroundColor: 'var(--card-background-color)', borderRadius: 'var(--border-radius)', boxShadow: 'var(--box-shadow)', overflowX: 'auto', marginTop: '20px' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { padding: '12px 15px', textAlign: 'left', borderBottom: '2px solid var(--border-color)', backgroundColor: '#f8f9fa', fontWeight: 600, cursor: 'pointer', userSelect: 'none' },
    td: { padding: '12px 15px', borderBottom: '1px solid var(--border-color)' },
    actionCell: { display: 'flex', gap: '10px' },
    button: { padding: '6px 12px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', background: 'none' },
    dangerButton: { borderColor: 'var(--danger-color)', color: 'var(--danger-color)' },
    message: { textAlign: 'center', padding: '50px', fontSize: '1.2rem', color: '#666' },
    error: { color: 'var(--danger-color)', padding: '20px', backgroundColor: '#fdd', borderRadius: 'var(--border-radius)' },
    modalBackdrop: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
    modalContent: { backgroundColor: 'white', padding: '30px', borderRadius: 'var(--border-radius)', width: '90%', maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '20px' },
    modalHeader: { fontSize: '1.5rem', margin: 0, paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' },
    formGroup: { display: 'flex', flexDirection: 'column', gap: '5px' },
    label: { fontWeight: 500 },
    input: { padding: '10px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '1rem' },
    modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' },
};

export function ListingView() {
    const [listings, setListings] = useState<ProductListing[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingListing, setEditingListing] = useState<Partial<ProductListing> | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: keyof ProductListing; direction: 'ascending' | 'descending' }>({ key: 'asin', direction: 'ascending' });

    const fetchListings = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch('/api/listings');
            if (!response.ok) throw new Error('Failed to fetch listings.');
            const data = await response.json();
            setListings(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchListings();
    }, [fetchListings]);

    const handleOpenModal = (listing: Partial<ProductListing> | null = null) => {
        setEditingListing(listing || { asin: '', sku: '', title: '' });
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingListing(null);
    };

    const handleSave = async () => {
        if (!editingListing) return;
        const { id, ...data } = editingListing;
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/listings/${id}` : '/api/listings';
        
        try {
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Failed to ${id ? 'update' : 'create'} listing.`);
            }
            handleCloseModal();
            fetchListings(); // Refresh data
        } catch (err) {
            alert(err instanceof Error ? err.message : 'An unknown error occurred.');
        }
    };

    const handleDelete = async (id: number) => {
        if (window.confirm('Are you sure you want to delete this listing?')) {
            try {
                const response = await fetch(`/api/listings/${id}`, { method: 'DELETE' });
                if (!response.ok && response.status !== 204) {
                    throw new Error('Failed to delete listing.');
                }
                fetchListings(); // Refresh data
            } catch (err) {
                alert(err instanceof Error ? err.message : 'An unknown error occurred.');
            }
        }
    };

    const sortedListings = useMemo(() => {
        let sortableItems = [...listings];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [listings, sortConfig]);

    const requestSort = (key: keyof ProductListing) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    return (
        <div style={styles.container}>
            <header style={styles.header}>
                <h1 style={styles.title}>Product Listings</h1>
                <button style={styles.primaryButton} onClick={() => handleOpenModal()}>+ Add New Listing</button>
            </header>

            {error && <div style={styles.error} role="alert">{error}</div>}

            <div style={styles.tableContainer}>
                {loading ? <div style={styles.message}>Loading...</div> :
                 sortedListings.length === 0 && !error ? <div style={styles.message}>No listings found. Add one to get started.</div> :
                 (
                    <table style={styles.table}>
                        <thead>
                            <tr>
                                <th style={styles.th} onClick={() => requestSort('asin')}>ASIN {sortConfig.key === 'asin' ? (sortConfig.direction === 'ascending' ? '▲' : '▼') : ''}</th>
                                <th style={styles.th} onClick={() => requestSort('sku')}>SKU {sortConfig.key === 'sku' ? (sortConfig.direction === 'ascending' ? '▲' : '▼') : ''}</th>
                                <th style={styles.th} onClick={() => requestSort('title')}>Title {sortConfig.key === 'title' ? (sortConfig.direction === 'ascending' ? '▲' : '▼') : ''}</th>
                                <th style={{...styles.th, cursor: 'default'}}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedListings.map(listing => (
                                <tr key={listing.id}>
                                    <td style={styles.td}>{listing.asin}</td>
                                    <td style={styles.td}>{listing.sku}</td>
                                    <td style={styles.td}>{listing.title}</td>
                                    <td style={styles.td}>
                                        <div style={styles.actionCell}>
                                            <button style={styles.button} onClick={() => handleOpenModal(listing)}>Edit</button>
                                            <button style={{...styles.button, ...styles.dangerButton}} onClick={() => handleDelete(listing.id)}>Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                 )
                }
            </div>

            {isModalOpen && (
                <div style={styles.modalBackdrop} onClick={handleCloseModal}>
                    <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <h2 style={styles.modalHeader}>{editingListing?.id ? 'Edit Listing' : 'Add New Listing'}</h2>
                        <div style={styles.formGroup}>
                            <label style={styles.label} htmlFor="asin">ASIN</label>
                            <input id="asin" style={styles.input} value={editingListing?.asin} onChange={e => setEditingListing(p => ({...p, asin: e.target.value}))} required />
                        </div>
                         <div style={styles.formGroup}>
                            <label style={styles.label} htmlFor="sku">SKU</label>
                            <input id="sku" style={styles.input} value={editingListing?.sku} onChange={e => setEditingListing(p => ({...p, sku: e.target.value}))} required />
                        </div>
                         <div style={styles.formGroup}>
                            <label style={styles.label} htmlFor="title">Title</label>
                            <input id="title" style={styles.input} value={editingListing?.title} onChange={e => setEditingListing(p => ({...p, title: e.target.value}))} />
                        </div>
                        <div style={styles.modalFooter}>
                             <button style={styles.button} onClick={handleCloseModal}>Cancel</button>
                             <button style={styles.primaryButton} onClick={handleSave}>Save</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}