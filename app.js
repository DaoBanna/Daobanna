const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyQ3Z36H2V5mbmVIN_Rj0x4NgM-swfwp2xvOY8IbbTDd_NvZqbssKXXVmuIKXxR0t0/exec'; 
    
async function callAPI(action, data = null, retries = 3) {
    try {
        if (!navigator.onLine) {
            throw new Error("❌ ขาดการเชื่อมต่ออินเทอร์เน็ต! กรุณาเช็คสัญญาณเน็ตก่อนบันทึกข้อมูลครับ");
        }

        const method = data ? 'POST' : 'GET';
        const payloadStr = data ? encodeURIComponent(JSON.stringify(data)) : '';
        // แนบ Date.now() ไปกับ API เพื่อป้องกันเบราว์เซอร์จำข้อมูล JSON เก่า
        const fetchUrl = method === 'GET' 
            ? `${SCRIPT_URL}?action=${action}&t=${Date.now()}` 
            : `${SCRIPT_URL}?action=${action}&payload=${payloadStr}`;
        
        const options = { method: method };
        
        if (method === 'POST') {
            options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
            options.body = JSON.stringify({ action: action, data: data });
        }

        const response = await fetch(fetchUrl, options);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const textData = await response.text();
        if (textData.trim().startsWith('<')) throw new Error("ติดหน้าเว็บของ Google! กรุณาเปิดโหมดไม่ระบุตัวตน");
        
        let result;
        try { 
            result = JSON.parse(textData); 
        } catch (err) { 
            throw new Error("ข้อมูลตอบกลับไม่ใช่ JSON"); 
        }
        
        if (result.error) throw new Error(result.message ? result.message : result.error);
        
        return result;
    } catch (err) { 
        if (retries > 0 && !data) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            return callAPI(action, data, retries - 1);
        }
        throw err; 
    }
}

const app = {
    data: [], 
    categories: [], 
    products: [], 
    filteredData: [], 
    currentPage: 1, 
    rowsPerPage: 15, 
    currentTab: 'all', 
    sortCol: 'date', 
    sortAsc: false, 
    charts: { trend: null, cat: null }, 
    activeInput: null, 
    lastReceiptData: null,
    isInitialLoad: true,
    isSaving: false,
    
    init: function() {
        this.fetchData(); 
        this.setupListeners();
        
        const multiDate = document.getElementById('multi-date'); 
        if(multiDate) multiDate.valueAsDate = new Date(); 
        
        document.addEventListener('click', (e) => { 
            const dropdown = document.getElementById('global-dropdown'); 
            if (this.activeInput && !this.activeInput.contains(e.target) && !dropdown.contains(e.target)) { 
                dropdown.style.display = 'none'; 
                this.activeInput = null; 
            } 
        });
        
        document.addEventListener('scroll', (e) => { 
            const dropdown = document.getElementById('global-dropdown'); 
            if (e.target === dropdown || dropdown.contains(e.target)) return; 
            if(dropdown.style.display === 'block') { 
                dropdown.style.display = 'none'; 
                this.activeInput = null; 
            } 
        }, true);
        
        const scrollArea = document.getElementById('multi-scroll-area'); 
        if(scrollArea) { 
            scrollArea.addEventListener('scroll', () => { 
                const dropdown = document.getElementById('global-dropdown'); 
                if(dropdown.style.display === 'block') { 
                    dropdown.style.display = 'none'; 
                    this.activeInput = null; 
                } 
            }); 
        }

        // ระบบ Auto-Sync: ดึงข้อมูลเบื้องหลังทุก 1 นาที เพื่อให้อัปเดตตลอดเวลา
        setInterval(() => {
            if (!this.isSaving) this.fetchData(true);
        }, 60000);

        // ระบบ Auto-Sync: ดึงข้อมูลทันทีเมื่อสลับแอป หรือเปิดหน้าจอมือถือกลับมา
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isSaving) {
                this.fetchData(true);
            }
        });
        window.addEventListener('focus', () => {
            if (!this.isSaving) this.fetchData(true);
        });
    },
    
    enterApp: function(action) {
        if (action === 'add') { 
            this.openMultiModal(); 
        } else { 
            const welcome = document.getElementById('welcome-screen'); 
            welcome.style.opacity = '0'; 
            setTimeout(() => { 
                welcome.classList.add('hidden'); 
                this.switchView('dashboard'); 
                this.applyFilters();
            }, 700); 
        }
    },
    
    toggleMobileMenu: function() { 
        document.getElementById('mobile-menu').classList.toggle('hidden'); 
    },

    toggleFilters: function() {
        const container = document.getElementById('filter-container');
        const icon = document.getElementById('filter-icon-chevron');
        if (container.classList.contains('hidden')) {
            container.classList.remove('hidden');
            icon.classList.add('rotate-180');
        } else {
            container.classList.add('hidden');
            icon.classList.remove('rotate-180');
        }
    },
    
    // ฟังก์ชันดึงข้อมูลแบบใหม่ ลบ Cache เดิมทิ้งหมด และรองรับการดึงแบบเงียบๆ (Silent)
    fetchData: async function(isSilent = false) {
        if (!isSilent && this.data.length === 0) {
            const l = document.getElementById('loader');
            if (l) { l.style.opacity = '1'; l.classList.remove('hidden'); }
        }

        try {
            // โหลด 1000 รายการแรกมาก่อน
            const res = await callAPI('getInitialData');
            this.data = res.transactions;
            this.processData();

            if (!isSilent) {
                const l = document.getElementById('loader');
                if (l) { l.style.opacity = '0'; setTimeout(() => l.classList.add('hidden'), 500); }
            }

            // แอบโหลด Archive ที่เหลือมาเติมให้เต็ม
            const archiveRes = await callAPI('getArchiveData');
            if (archiveRes.transactions && archiveRes.transactions.length > 0) {
                this.data = this.data.concat(archiveRes.transactions);
                this.processData();
            }
        } catch (e) {
            if (!isSilent) {
                const l = document.getElementById('loader');
                if (l) { l.style.opacity = '0'; setTimeout(() => l.classList.add('hidden'), 500); }
                if (this.data.length === 0) Swal.fire('เกิดข้อผิดพลาดในการโหลดข้อมูล', e.message, 'error');
            }
        }
    },

    processData: function() {
        const pCounts = {}; 
        const cCounts = {};
        
        this.data.forEach(t => { 
            if (t.product) pCounts[t.product] = (pCounts[t.product] || 0) + 1; 
            if (t.category) cCounts[t.category] = (cCounts[t.category] || 0) + 1; 
        });
        
        this.categories = [...new Set(this.data.map(t => t.category))].filter(String).sort((a, b) => cCounts[b] - cCounts[a]);
        this.products = [...new Set(this.data.map(t => t.product))].filter(String).sort((a, b) => pCounts[b] - pCounts[a]);
        
        this.populateYearFilters(); 
        this.populateDayFilters();
        
        const yEl = document.getElementById('dash-year'); 
        const mEl = document.getElementById('dash-month');
        const fyEl = document.getElementById('filter-year'); 
        const fmEl = document.getElementById('filter-month');

        if (this.isInitialLoad) {
            const today = new Date(); 
            const curYear = today.getFullYear().toString();
            const curMonth = today.getMonth().toString();

            if(yEl) yEl.value = curYear; 
            if(mEl) mEl.value = curMonth;
            if(fyEl) fyEl.value = curYear;
            if(fmEl) fmEl.value = curMonth;

            this.isInitialLoad = false;
        }

        if(yEl && !yEl.value) yEl.value = new Date().getFullYear();
        if(mEl && !mEl.value) mEl.value = new Date().getMonth();
        if(fyEl && !fyEl.value) fyEl.value = new Date().getFullYear();
        if(fmEl && !fmEl.value) fmEl.value = new Date().getMonth();
        
        this.renderDashboard(); 
        this.applyFilters(); 
        this.renderStock(); 
    },
    
    populateYearFilters: function() {
        const years = [...new Set(this.data.map(t => new Date(t.date).getFullYear()))].sort((a,b) => b-a);
        const currentYear = new Date().getFullYear();
        
        if (!years.includes(currentYear)) years.unshift(currentYear); 
        
        const html = '<option value="all">ทุกปี</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
        
        const fy = document.getElementById('filter-year');
        const dy = document.getElementById('dash-year');
        const fyVal = fy ? fy.value : null;
        const dyVal = dy ? dy.value : null;

        if(fy) { fy.innerHTML = html; if(fyVal) fy.value = fyVal; }
        if(dy) { dy.innerHTML = html; if(dyVal) dy.value = dyVal; }
    },
    
    populateDayFilters: function() {
        const days = Array.from({length: 31}, (_, i) => i + 1);
        const html = '<option value="all">ทุกวัน</option>' + days.map(d => `<option value="${d}">${d}</option>`).join('');
        
        const fd = document.getElementById('filter-day');
        const dd = document.getElementById('dash-day');
        const fdVal = fd ? fd.value : null;
        const ddVal = dd ? dd.value : null;

        if(fd) { fd.innerHTML = html; if(fdVal) fd.value = fdVal; }
        if(dd) { dd.innerHTML = html; if(ddVal) dd.value = ddVal; }
    },
    
    switchView: function(viewId) {
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        const target = document.getElementById('view-' + viewId);
        
        if(target) target.classList.remove('hidden'); 
        
        document.querySelectorAll('.nav-item').forEach(el => { 
            el.classList.remove('bg-white/10', 'text-white'); 
            el.classList.add('text-slate-300'); 
        });
        
        const activeNav = document.getElementById('nav-' + viewId);
        if(activeNav) { 
            activeNav.classList.add('bg-white/10', 'text-white'); 
            activeNav.classList.remove('text-slate-300'); 
        }
        
        if(viewId === 'dashboard') { 
            if(target) target.classList.remove('opacity-0'); 
            this.renderDashboard(); 
        } else if (viewId === 'transactions') {
            this.applyFilters();
        } else if (viewId === 'stock') {
            this.renderStock();
        }
    },
    
    renderDashboard: function() {
        const yEl = document.getElementById('dash-year'); 
        const mEl = document.getElementById('dash-month'); 
        const dDropEl = document.getElementById('dash-day'); 
        const wEl = document.getElementById('dash-week'); 
        const dSingleEl = document.getElementById('dash-single-date'); 
        const dStartEl = document.getElementById('dash-date-start'); 
        const dEndEl = document.getElementById('dash-date-end');
        
        if(!yEl || !mEl || !wEl) return;
        
        const today = new Date();
        const y = yEl.value || today.getFullYear().toString(); 
        const m = mEl.value || today.getMonth().toString(); 
        const dDrop = dDropEl && dDropEl.value ? dDropEl.value : 'all'; 
        const w = wEl && wEl.value ? wEl.value : 'all';
        
        const dSingle = dSingleEl && dSingleEl.value ? new Date(dSingleEl.value).setHours(0,0,0,0) : null;
        const dStart = dStartEl && dStartEl.value ? new Date(dStartEl.value).setHours(0,0,0,0) : null;
        const dEnd = dEndEl && dEndEl.value ? new Date(dEndEl.value).setHours(23,59,59,999) : null;
        
        const filtered = this.data.filter(t => {
            const d = new Date(t.date); 
            const tTime = d.getTime(); 
            const tDateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            
            if (dSingle && tDateOnly !== dSingle) return false; 
            if (dStart && tTime < dStart) return false; 
            if (dEnd && tTime > dEnd) return false;
            
            const matchY = y === 'all' || d.getFullYear() == y; 
            const matchM = m === 'all' || d.getMonth() == m; 
            const matchD = dDrop === 'all' || d.getDate() == dDrop; 
            const matchW = w === 'all' || this.getWeekOfMonth(d) == w;
            
            return matchY && matchM && matchD && matchW;
        });
        
        const totalSales = filtered.filter(t => t.type === 'ขาย').reduce((s,t) => s + t.total, 0);
        const totalCost = filtered.filter(t => t.type === 'ซื้อ').reduce((s,t) => s + t.total, 0);
        const profit = totalSales - totalCost;
        
        document.getElementById('kpi-sales').textContent = totalSales.toLocaleString(undefined, {minimumFractionDigits:2}) + ' ฿'; 
        document.getElementById('kpi-cost').textContent = totalCost.toLocaleString(undefined, {minimumFractionDigits:2}) + ' ฿'; 
        document.getElementById('kpi-profit').textContent = profit.toLocaleString(undefined, {minimumFractionDigits:2}) + ' ฿';
        
        let profitPercent = 0; 
        if(totalSales > 0) profitPercent = Math.max(0, Math.min(100, (profit / totalSales) * 100)); 
        
        const profitBar = document.getElementById('profit-bar'); 
        if(profitBar) profitBar.style.width = profitPercent + '%'; 
        
        const recentTable = document.getElementById('dashboard-recent-table');
        const recentItems = [...filtered].sort((a,b) => { 
            const dateDiff = b.date - a.date; 
            if (dateDiff !== 0) return dateDiff; 
            return b.id - a.id; 
        }).slice(0, 5);
        
        if(recentItems.length === 0) { 
            recentTable.innerHTML = `<tr class="block md:table-row"><td colspan="4" class="p-6 text-center text-slate-400 block md:table-cell">ยังไม่มีรายการในช่วงนี้</td></tr>`; 
        } else {
            recentTable.innerHTML = recentItems.map(t => {
                const badge = t.type === 'ขาย' 
                    ? `<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">ขาย</span>` 
                    : `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[10px] font-bold">ซื้อ</span>`;
                
                const dateObj = new Date(t.date);
                const dateStr = dateObj.toLocaleDateString('th-TH');
                const timeStr = dateObj.toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'});
                const refId = "Ref-" + String(t.date).slice(-4);
                
                return `
                <tr class="block md:table-row bg-white border border-slate-200 md:border-b md:border-slate-100 md:border-x-0 md:border-t-0 rounded-lg md:rounded-none mb-3 shadow-sm hover:bg-slate-50 transition">
                    <td class="md:hidden p-3 block">
                        <div class="flex items-center justify-between mb-3">
                            <div class="flex-1 min-w-0 pr-2">
                                <div class="font-bold text-sm text-slate-800 truncate">${t.product}</div>
                                <div class="text-[10px] text-slate-400 mb-1 truncate">${t.category}</div>
                                <div class="flex items-center gap-1 text-[9px] text-slate-500">
                                    <i class="fa-regular fa-clock"></i> ${dateStr} ${timeStr} 
                                </div>
                                <div class="text-[9px] font-bold text-indigo-500 mt-0.5">${refId}</div>
                            </div>
                            <div class="flex flex-col items-center justify-center px-2 border-x border-slate-100 min-w-[75px] shrink-0">
                                <div class="mb-1">${badge}</div>
                                <div class="text-[10px] text-slate-500 whitespace-nowrap">${t.price.toLocaleString()} x ${t.quantity}</div>
                                <div class="text-[9px] text-slate-400">${t.unit}</div>
                            </div>
                            <div class="flex flex-col items-end justify-center pl-2 min-w-[70px] shrink-0">
                                <div class="font-bold text-sm text-indigo-600">${t.total.toLocaleString()} ฿</div>
                            </div>
                        </div>
                    </td>
                    <td class="hidden md:table-cell p-3 md:p-4 text-slate-500 text-sm">
                        ${dateStr} <span class="text-[10px] text-slate-400 block">${timeStr} <b class="text-indigo-400">${refId}</b></span>
                    </td>
                    <td class="hidden md:table-cell p-3 md:p-4 font-medium text-slate-700">
                        ${t.product}
                        <div class="text-[10px] md:text-xs text-slate-400">${t.category}</div>
                    </td>
                    <td class="hidden md:table-cell p-3 md:p-4">${badge}</td>
                    <td class="hidden md:table-cell p-3 md:p-4 text-right font-bold text-slate-600 text-xs md:text-sm">${t.total.toLocaleString()} ฿</td>
                </tr>
            `}).join('');
        }
        
        this.renderCharts(filtered);
    },
    
    renderCharts: function(data) {
        try {
            const ctxTrend = document.getElementById('chart-trend').getContext('2d');
            const emptyTrend = document.getElementById('empty-trend');
            if (this.charts.trend) this.charts.trend.destroy(); 
            
            const groupedData = {};
            let hasTrendData = false;
            data.forEach(t => {
                hasTrendData = true;
                const d = new Date(t.date);
                const isYearView = document.getElementById('dash-month').value === 'all';
                const key = isYearView 
                    ? `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}` 
                    : `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
                
                if (!groupedData[key]) groupedData[key] = { sales: 0, cost: 0 };
                if (t.type === 'ขาย') groupedData[key].sales += t.total; 
                if (t.type === 'ซื้อ') groupedData[key].cost += t.total; 
            });
            
            if (!hasTrendData) {
                document.getElementById('chart-trend').style.display = 'none';
                if(emptyTrend) emptyTrend.classList.remove('hidden');
            } else {
                document.getElementById('chart-trend').style.display = 'block';
                if(emptyTrend) emptyTrend.classList.add('hidden');
                
                const sortedKeys = Object.keys(groupedData).sort();
                const labels = sortedKeys.map(k => { 
                    const parts = k.split('-'); 
                    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : `${parts[1]}/${parts[0]}`; 
                });
                
                this.charts.trend = new Chart(ctxTrend, {
                    type: 'bar',
                    data: { 
                        labels: labels, 
                        datasets: [ 
                            { label: 'รายได้', data: sortedKeys.map(k => groupedData[k].sales), backgroundColor: '#4f46e5', borderRadius: 4 }, 
                            { label: 'รายจ่าย', data: sortedKeys.map(k => groupedData[k].cost), backgroundColor: '#f43f5e', borderRadius: 4 } 
                        ] 
                    },
                    options: { 
                        responsive: true, 
                        maintainAspectRatio: false, 
                        interaction: { mode: 'index', intersect: false }, 
                        plugins: { legend: { position: 'top', align: 'end' } }, 
                        scales: { x: { grid: { display: false } }, y: { grid: { borderDash: [5, 5] }, beginAtZero: true } } 
                    }
                });
            }
            
            const ctxCat = document.getElementById('chart-category').getContext('2d');
            const emptyCat = document.getElementById('empty-cat');
            if (this.charts.cat) this.charts.cat.destroy(); 
            
            const productSales = {}; 
            let hasCatData = false;
            data.filter(t => t.type === 'ขาย').forEach(t => { 
                productSales[t.product] = (productSales[t.product] || 0) + t.total; 
                hasCatData = true;
            });
            
            if (!hasCatData) {
                document.getElementById('chart-category').style.display = 'none';
                if(emptyCat) emptyCat.classList.remove('hidden');
            } else {
                document.getElementById('chart-category').style.display = 'block';
                if(emptyCat) emptyCat.classList.add('hidden');
                
                const topProducts = Object.entries(productSales).sort((a,b) => b[1] - a[1]).slice(0, 5);
                
                this.charts.cat = new Chart(ctxCat, {
                    type: 'doughnut', 
                    data: { 
                        labels: topProducts.map(p => p[0]), 
                        datasets: [{ data: topProducts.map(p => p[1]), backgroundColor: ['#4f46e5', '#f43f5e', '#0ea5e9', '#8b5cf6', '#10b981'], borderWidth: 0 }] 
                    },
                    options: { 
                        responsive: true, 
                        maintainAspectRatio: false, 
                        cutout: '70%', 
                        plugins: { legend: { position: 'right' } } 
                    }
                });
            }
        } catch (error) {}
    },
    
    filterType: function(type) {
        this.currentTab = type; 
        this.currentPage = 1;
        
        ['all', 'buy', 'sell'].forEach(t => { 
            let btnId = 'tab-all'; 
            if(t === 'buy') btnId = 'tab-buy'; 
            if(t === 'sell') btnId = 'tab-sell'; 
            const btn = document.getElementById(btnId); 
            if(btn) btn.className = "flex-1 md:flex-none px-3 md:px-5 py-1.5 md:py-2 rounded-md font-medium transition text-slate-500 hover:bg-slate-50 whitespace-nowrap"; 
        });
        
        let activeId = 'tab-all'; 
        if(type === 'ซื้อ') activeId = 'tab-buy'; 
        if(type === 'ขาย') activeId = 'tab-sell';
        
        const activeBtn = document.getElementById(activeId); 
        if(activeBtn) activeBtn.className = "flex-1 md:flex-none px-3 md:px-5 py-1.5 md:py-2 rounded-md font-medium transition bg-slate-800 text-white shadow whitespace-nowrap"; 
        
        this.applyFilters();
    },
    
    sortData: function(col) {
        if(this.sortCol === col) { 
            this.sortAsc = !this.sortAsc; 
        } else { 
            this.sortCol = col; 
            this.sortAsc = true; 
        }
        this.applyFilters();
    },
    
    applyFilters: function() {
        const searchEl = document.getElementById('search-input'); 
        const yEl = document.getElementById('filter-year'); 
        const mEl = document.getElementById('filter-month'); 
        const dDropEl = document.getElementById('filter-day'); 
        const wEl = document.getElementById('filter-week'); 
        const dSingleEl = document.getElementById('filter-single-date'); 
        const dStartEl = document.getElementById('filter-date-start'); 
        const dEndEl = document.getElementById('filter-date-end');
        
        const search = searchEl ? searchEl.value.toLowerCase() : ''; 
        const y = yEl ? yEl.value : 'all'; 
        const m = mEl ? mEl.value : 'all'; 
        const dDrop = dDropEl ? dDropEl.value : 'all'; 
        const w = wEl ? wEl.value : 'all';
        
        const dSingle = dSingleEl && dSingleEl.value ? new Date(dSingleEl.value).setHours(0,0,0,0) : null;
        const dStart = dStartEl && dStartEl.value ? new Date(dStartEl.value).setHours(0,0,0,0) : null;
        const dEnd = dEndEl && dEndEl.value ? new Date(dEndEl.value).setHours(23,59,59,999) : null;
        
        let temp = this.data.filter(t => {
            const d = new Date(t.date); 
            const tTime = d.getTime(); 
            const tDateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            
            if (dSingle && tDateOnly !== dSingle) return false; 
            if (dStart && tTime < dStart) return false; 
            if (dEnd && tTime > dEnd) return false;
            
            const matchSearch = t.product.toLowerCase().includes(search) || t.category.toLowerCase().includes(search);
            const matchTab = this.currentTab === 'all' || t.type === this.currentTab;
            const matchY = y === 'all' || d.getFullYear() == y; 
            const matchM = m === 'all' || d.getMonth() == m; 
            const matchD = dDrop === 'all' || d.getDate() == dDrop; 
            const matchW = w === 'all' || this.getWeekOfMonth(d) == w;
            
            return matchSearch && matchTab && matchY && matchM && matchD && matchW;
        });
        
        temp.sort((a,b) => {
            let vA = a[this.sortCol]; 
            let vB = b[this.sortCol];
            
            if (this.sortCol === 'date') { 
                if (vA === vB) return this.sortAsc ? a.id - b.id : b.id - a.id; 
                return this.sortAsc ? vA - vB : vB - vA; 
            }
            
            if(typeof vA === 'string') vA = vA.toLowerCase(); 
            if(typeof vB === 'string') vB = vB.toLowerCase();
            
            if(vA < vB) return this.sortAsc ? -1 : 1; 
            if(vA > vB) return this.sortAsc ? 1 : -1; 
            return 0;
        });
        
        this.filteredData = temp; 
        this.renderTable();
        this.renderSummary();
    },

    renderSummary: function() {
        const summaryBar = document.getElementById('filter-summary-bar');
        if(!summaryBar) return;

        let buyTotal = 0, buyQty = 0;
        let sellTotal = 0, sellQty = 0;

        this.filteredData.forEach(t => {
            if (t.type === 'ซื้อ') {
                buyTotal += t.total;
                buyQty += t.quantity;
            } else if (t.type === 'ขาย') {
                sellTotal += t.total;
                sellQty += t.quantity;
            }
        });

        const dSingle = document.getElementById('filter-single-date') ? document.getElementById('filter-single-date').value : null;
        const dStart = document.getElementById('filter-date-start') ? document.getElementById('filter-date-start').value : null;
        const dEnd = document.getElementById('filter-date-end') ? document.getElementById('filter-date-end').value : null;
        const mVal = document.getElementById('filter-month') ? document.getElementById('filter-month').value : 'all';
        const yVal = document.getElementById('filter-year') ? document.getElementById('filter-year').value : 'all';
        const dVal = document.getElementById('filter-day') ? document.getElementById('filter-day').value : 'all';
        
        const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
        
        let contextText = "ข้อมูลทั้งหมด";

        if (dSingle) {
            const d = new Date(dSingle);
            contextText = `วันที่ ${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()+543}`;
        } else if (dStart && dEnd) {
            contextText = `ช่วงวันที่เลือก`;
        } else if (dVal !== 'all' && mVal !== 'all' && yVal !== 'all') {
            contextText = `วันที่ ${dVal} ${thaiMonths[parseInt(mVal)]} ${parseInt(yVal)+543}`;
        } else if (mVal !== 'all' && yVal !== 'all') {
            contextText = `เดือน ${thaiMonths[parseInt(mVal)]} ${parseInt(yVal)+543}`;
        } else if (yVal !== 'all') {
            contextText = `ปี ${parseInt(yVal)+543}`;
        }

        document.getElementById('sum-filtered-count').textContent = `${contextText} มี ${this.filteredData.length.toLocaleString()} รายการ`;
        document.getElementById('sum-filtered-buy').textContent = buyTotal.toLocaleString(undefined, {minimumFractionDigits: 2}) + ' ฿';
        document.getElementById('sum-filtered-buy-qty').textContent = (Math.round(buyQty * 100) / 100).toLocaleString();
        document.getElementById('sum-filtered-sell').textContent = sellTotal.toLocaleString(undefined, {minimumFractionDigits: 2}) + ' ฿';
        document.getElementById('sum-filtered-sell-qty').textContent = (Math.round(sellQty * 100) / 100).toLocaleString();
    },
    
    renderTable: function() {
        const tbody = document.getElementById('table-transactions'); 
        if(!tbody) return; 
        tbody.innerHTML = '';
        
        const start = (this.currentPage - 1) * this.rowsPerPage; 
        const pageData = this.filteredData.slice(start, start + this.rowsPerPage);
        
        if(pageData.length === 0) { 
            tbody.innerHTML = `<tr class="block md:table-row"><td colspan="7" class="p-8 text-center text-slate-400 block md:table-cell">ไม่พบข้อมูล</td></tr>`; 
            this.renderPagination(0); 
            return; 
        }
        
        pageData.forEach(t => {
            const badge = t.type === 'ขาย' 
                ? `<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">ขาย</span>` 
                : `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[10px] font-bold">ซื้อ</span>`;
            
            const dateObj = new Date(t.date);
            const dateStr = dateObj.toLocaleDateString('th-TH');
            const timeStr = dateObj.toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'});
            const refId = "Ref-" + String(t.date).slice(-4);
            
            const tr = document.createElement('tr'); 
            tr.className = "block md:table-row bg-white border border-slate-200 md:border-b md:border-slate-100 md:border-x-0 md:border-t-0 rounded-lg md:rounded-none mb-3 md:mb-0 shadow-sm md:shadow-none hover:bg-slate-50 transition";
            
            tr.innerHTML = `
                <td class="md:hidden p-3 block">
                    <div class="flex items-center justify-between mb-3">
                        <div class="flex-1 min-w-0 pr-2">
                            <div class="font-bold text-sm text-slate-800 truncate">${t.product}</div>
                            <div class="text-[10px] text-slate-400 mb-1 truncate">${t.category}</div>
                            <div class="flex items-center gap-1 text-[9px] text-slate-500">
                                <i class="fa-regular fa-clock"></i> ${dateStr} ${timeStr} 
                            </div>
                            <div class="text-[9px] font-bold text-indigo-500 mt-0.5">${refId}</div>
                        </div>
                        
                        <div class="flex flex-col items-center justify-center px-2 border-x border-slate-100 min-w-[75px] shrink-0">
                            <div class="mb-1">${badge}</div>
                            <div class="text-[10px] text-slate-500 whitespace-nowrap">${t.price.toLocaleString()} x ${t.quantity}</div>
                            <div class="text-[9px] text-slate-400">${t.unit}</div>
                        </div>
                        
                        <div class="flex flex-col items-end justify-center pl-2 min-w-[70px] shrink-0">
                            <div class="font-bold text-sm text-indigo-600">${t.total.toLocaleString()} ฿</div>
                        </div>
                    </div>
                    
                    <div class="pt-2 border-t border-slate-100 grid grid-cols-3 gap-2">
                        <button class="text-indigo-500 py-1.5 bg-indigo-50 rounded-md text-xs font-medium hover:bg-indigo-100 active:scale-95 transition flex items-center justify-center gap-1.5" onclick="app.reprintReceipt(${t.date}, '${t.type}')"><i class="fa-solid fa-print"></i> พิมพ์</button>
                        <button class="text-amber-500 py-1.5 bg-amber-50 rounded-md text-xs font-medium hover:bg-amber-100 active:scale-95 transition flex items-center justify-center gap-1.5" onclick="app.openEditModal(${t.id})"><i class="fa-solid fa-edit"></i> แก้ไข</button>
                        <button class="text-rose-500 py-1.5 bg-rose-50 rounded-md text-xs font-medium hover:bg-rose-100 active:scale-95 transition flex items-center justify-center gap-1.5" onclick="app.deleteItem(${t.id})"><i class="fa-solid fa-trash"></i> ลบ</button>
                    </div>
                </td>
                
                <td class="hidden md:table-cell p-3 md:p-4 text-slate-500 text-sm">
                    ${dateStr} <span class="text-[10px] text-slate-400 block">${timeStr} <b class="text-indigo-400">${refId}</b></span>
                </td>
                <td class="hidden md:table-cell p-3 md:p-4">${badge}</td>
                <td class="hidden md:table-cell p-3 md:p-4 font-medium text-slate-700">
                    ${t.product}
                    <div class="text-[10px] md:text-xs text-slate-400">${t.category}</div>
                </td>
                <td class="hidden md:table-cell p-3 md:p-4 text-right">${t.price.toLocaleString()}</td>
                <td class="hidden md:table-cell p-3 md:p-4 text-right">${t.quantity} ${t.unit}</td>
                <td class="hidden md:table-cell p-3 md:p-4 text-right font-bold text-slate-700">${t.total.toLocaleString()}</td>
                <td class="hidden md:table-cell p-3 md:p-4 text-center whitespace-nowrap">
                    <button class="text-indigo-500 hover:text-indigo-700 mx-1 p-1.5 bg-indigo-50 rounded-full transition" onclick="app.reprintReceipt(${t.date}, '${t.type}')" title="พิมพ์ใบเสร็จ"><i class="fa-solid fa-print"></i></button>
                    <button class="text-amber-500 hover:text-amber-700 mx-1 p-1.5 bg-amber-50 rounded-full transition" onclick="app.openEditModal(${t.id})" title="แก้ไข"><i class="fa-solid fa-edit"></i></button>
                    <button class="text-rose-400 hover:text-rose-600 mx-1 p-1.5 bg-rose-50 rounded-full transition" onclick="app.deleteItem(${t.id})" title="ลบ"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        this.renderPagination(Math.ceil(this.filteredData.length / this.rowsPerPage));
    },
    
    renderPagination: function(totalPages) {
        const div = document.getElementById('pagination'); 
        if(!div) return; 
        
        if(totalPages === 0) { 
            div.innerHTML=''; 
            return; 
        }
        
        div.innerHTML = `
            <span>หน้า ${this.currentPage}/${totalPages} (${this.filteredData.length} รายการ)</span>
            <div class="space-x-1">
                <button onclick="app.changePage(-1)" class="px-3 py-1 border border-slate-200 rounded hover:bg-slate-100 transition" ${this.currentPage===1?'disabled':''}>ก่อนหน้า</button>
                <button onclick="app.changePage(1)" class="px-3 py-1 border border-slate-200 rounded hover:bg-slate-100 transition" ${this.currentPage>=totalPages?'disabled':''}>ถัดไป</button>
            </div>`;
    },
    
    changePage: function(d) { 
        this.currentPage += d; 
        this.renderTable(); 
    },
    
    getWeekOfMonth: function(date) { 
        return Math.ceil(new Date(date).getDate() / 7); 
    },
    
    openMultiModal: function() {
        document.getElementById('modal-multi').classList.remove('hidden'); 
        document.getElementById('multi-items-body').innerHTML = '';
        
        const typeSelect = document.getElementById('multi-type'); 
        typeSelect.value = 'ซื้อ';
        typeSelect.className = "modal-input border border-slate-300 rounded shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-rose-600 w-28 md:w-40";
        
        typeSelect.onchange = function() { 
            if(this.value === 'ขาย') { 
                this.className = "modal-input border border-slate-300 rounded shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-emerald-600 w-28 md:w-40"; 
            } else { 
                this.className = "modal-input border border-slate-300 rounded shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-rose-600 w-28 md:w-40"; 
            } 
        };
        
        this.addMultiRow(); 
        this.updateInfoDashboard(null); 
        document.getElementById('multi-grand-total').textContent = '0.00';
        
        const dateInput = document.getElementById('multi-date'); 
        if(dateInput) dateInput.valueAsDate = new Date(); 
    },
    
    closeMultiModal: function() { 
        document.getElementById('modal-multi').classList.add('hidden'); 
    },
    
    createInputHTML: function(type, rowId) {
        const ph = type === 'cat' ? 'หมวดหมู่' : 'พิมพ์เพื่อค้นหา...';
        return `<input type="text" name="${type}" class="modal-input w-full border border-slate-300 rounded-lg md:rounded outline-none bg-slate-50 md:bg-white transition focus:ring-2 focus:ring-indigo-500" placeholder="${ph}" onclick="app.showDropdown(this, '${type}')" oninput="app.filterDropdown(this, '${type}')" onchange="app.handleInputChange(this, '${type}')" autocomplete="off">`;
    },
    
    showDropdown: function(input, type) {
        this.filterDropdown(input, type);
    },
    
    filterDropdown: function(input, type) {
        this.activeInput = input;
        const dropdown = document.getElementById('global-dropdown');
        const rect = input.getBoundingClientRect();
        
        dropdown.style.top = (rect.bottom + 5) + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        
        const keyword = input.value.trim().toLowerCase();
        let items = [];
        
        if (type === 'cat') {
            items = this.categories;
        } else {
            const row = input.closest('.multi-row');
            const catVal = row.querySelector('[name="cat"]').value.trim();
            if (catVal) {
                const catData = this.data.filter(t => t.category === catVal);
                const pCountsLocal = {};
                catData.forEach(t => pCountsLocal[t.product] = (pCountsLocal[t.product] || 0) + 1);
                const productsInCat = [...new Set(catData.map(t => t.product))].sort((a,b) => pCountsLocal[b] - pCountsLocal[a]);
                items = productsInCat.length > 0 ? productsInCat : this.products;
            } else {
                items = this.products;
            }
        }
        
        if (keyword) {
            items = items.filter(item => item.toLowerCase().includes(keyword));
        }
        
        this.renderDropdownItems(items, type);
        dropdown.style.display = 'block';
    },
    
    renderDropdownItems: function(items, type) {
        const dropdown = document.getElementById('global-dropdown');
        const title = type === 'cat' ? 'หมวดหมู่' : 'สินค้า';
        
        let html = `<div class="p-2 border-b border-slate-200 bg-slate-100 text-slate-500 text-xs text-center">พิมพ์ชื่อใหม่ หรือ เลือกจากรายการ</div>`;
        
        if (items.length === 0) {
            html += `<div class="p-3 text-indigo-600 font-bold text-sm text-center bg-indigo-50"><i class="fa-solid fa-check-circle"></i> ใช้ชื่อใหม่ที่พิมพ์ได้เลย</div>`;
        } else {
            html += items.map(item => `<div class="dropdown-item text-sm py-3 md:py-2" onclick="app.selectItem('${item.replace(/'/g, "\\'")}', '${type}')">${item}</div>`).join('');
        }
        dropdown.innerHTML = html;
    },
    
    handleInputChange: function(input, type) {
        if (type === 'prod') {
            const val = input.value.trim();
            if (val) {
                this.updateInfoDashboard(val);
                const row = input.closest('.multi-row');
                const history = this.data.find(t => t.product === val);
                
                if (history) {
                    const catInput = row.querySelector('[name="cat"]');
                    if (catInput && !catInput.value) catInput.value = history.category || '';
                    
                    const unitInput = row.querySelector('[name="unit"]');
                    if (unitInput && !unitInput.value) unitInput.value = history.unit || 'ชิ้น';
                    
                    const currentType = document.getElementById('multi-type').value;
                    const priceInput = row.querySelector('[name="price"]');
                    if (priceInput && !priceInput.value) {
                        const lastRecord = this.data.filter(t => t.product === val && t.type === currentType).sort((a,b) => b.date - a.date)[0];
                        if (lastRecord) {
                            priceInput.value = lastRecord.price;
                            this.calcMultiTotal();
                        }
                    }
                }
            } else {
                this.updateInfoDashboard(null);
            }
        }
    },
    
    selectItem: function(val, type) {
        if (!this.activeInput) return;
        
        this.activeInput.value = val; 
        document.getElementById('global-dropdown').style.display = 'none';
        
        if (type === 'prod') {
            this.updateInfoDashboard(val); 
            const row = this.activeInput.closest('.multi-row'); 
            const history = this.data.find(t => t.product === val);
            
            if (history) {
                const catInput = row.querySelector('[name="cat"]'); 
                if (catInput) catInput.value = history.category || '';
                
                const unitInput = row.querySelector('[name="unit"]'); 
                if (unitInput && !unitInput.value) unitInput.value = history.unit || 'ชิ้น'; 
                
                const currentType = document.getElementById('multi-type').value; 
                const priceInput = row.querySelector('[name="price"]');
                const lastRecord = this.data.filter(t => t.product === val && t.type === currentType).sort((a,b) => b.date - a.date)[0];
                
                if (lastRecord && priceInput) { 
                    priceInput.value = lastRecord.price; 
                    this.calcMultiTotal(); 
                }
            }
        }
        this.activeInput = null;
    },
    
    addMultiRow: function() {
        const tbody = document.getElementById('multi-items-body'); 
        const rowIdx = tbody.children.length + 1; 
        const rowId = Date.now() + Math.random(); 
        const div = document.createElement('div');
        
        div.className = "multi-row relative bg-white p-3 md:p-1 border border-slate-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-3 md:mb-0 shadow-sm md:shadow-none transition-all";
        div.innerHTML = `
            <div class="flex justify-between md:hidden mb-2 pb-2 border-b border-slate-100">
                <span class="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">รายการที่ ${rowIdx}</span>
                <button onclick="this.closest('.multi-row').remove();app.calcMultiTotal()" class="text-white bg-rose-500 w-6 h-6 flex items-center justify-center rounded-full shadow"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="grid grid-cols-3 md:flex md:flex-row md:items-center gap-2 md:gap-0">
                <div class="hidden md:block w-8 text-center text-slate-400 text-[10px]">${rowIdx}</div>
                <div class="col-span-3 md:flex-1 md:px-1 relative"><label class="md:hidden text-[10px] text-slate-400 font-bold ml-1">ชื่อสินค้า</label>${this.createInputHTML('prod', rowId)}</div>
                <div class="col-span-3 md:w-40 md:px-1"><label class="md:hidden text-[10px] text-slate-400 font-bold ml-1">หมวดหมู่</label>${this.createInputHTML('cat', rowId)}</div>
                <div class="col-span-1 md:w-20 md:px-1"><label class="md:hidden text-[10px] text-slate-400 font-bold ml-1">ราคา</label><input type="number" inputmode="decimal" name="price" class="modal-input w-full border border-slate-300 rounded-lg md:rounded text-right outline-none focus:ring-2 focus:ring-indigo-500 transition" step="0.01" oninput="app.calcMultiTotal()" onclick="this.select()"></div>
                <div class="col-span-1 md:w-20 md:px-1"><label class="md:hidden text-[10px] text-slate-400 font-bold ml-1">จำนวน</label><input type="number" inputmode="decimal" name="qty" class="modal-input w-full border border-slate-300 rounded-lg md:rounded text-right outline-none focus:ring-2 focus:ring-indigo-500 transition" step="0.01" oninput="app.calcMultiTotal()" onclick="this.select()"></div>
                <div class="col-span-1 md:w-16 md:px-1"><label class="md:hidden text-[10px] text-slate-400 font-bold ml-1">หน่วย</label><input type="text" name="unit" class="modal-input w-full border border-slate-300 rounded-lg md:rounded text-center outline-none focus:ring-2 focus:ring-indigo-500 transition" placeholder="หน่วย" onclick="this.select()"></div>
                <div class="col-span-3 md:w-24 md:px-2 text-right bg-indigo-50 md:bg-transparent p-2 md:p-0 rounded-lg flex flex-row md:flex-col justify-between md:justify-center items-center mt-1 md:mt-0"><span class="md:hidden text-xs text-indigo-400 font-bold">รวมรายการนี้:</span><span class="font-bold text-indigo-600 md:text-slate-700 row-total text-base md:text-sm block">0.00</span></div>
                <div class="hidden md:block w-8 text-center"><button onclick="this.closest('.multi-row').remove();app.calcMultiTotal()" class="text-slate-300 hover:text-rose-500 p-1 rounded-full hover:bg-rose-50 transition"><i class="fa-solid fa-trash"></i></button></div>
            </div>
        `;
        tbody.appendChild(div);
    },
    
    calcMultiTotal: function() {
        let grandTotal = 0;
        
        document.querySelectorAll('.multi-row').forEach(row => {
            const p = parseFloat(row.querySelector('[name="price"]').value) || 0; 
            const q = parseFloat(row.querySelector('[name="qty"]').value) || 0; 
            const total = p * q; 
            row.querySelector('.row-total').textContent = total.toLocaleString(undefined, {minimumFractionDigits:2}); 
            grandTotal += total;
        });
        
        const totalDisplay = document.getElementById('multi-grand-total'); 
        if(totalDisplay) { 
            totalDisplay.textContent = grandTotal.toLocaleString(undefined, {minimumFractionDigits:2}); 
        }
    },
    
    updateInfoDashboard: function(productName) {
        const nameEl = document.getElementById('info-name'); 
        const stockEl = document.getElementById('info-stock'); 
        const buyEl = document.getElementById('info-buy'); 
        const sellEl = document.getElementById('info-sell');
        
        if(!productName) {
            if(nameEl) nameEl.textContent = 'ยังไม่ได้เลือกสินค้า'; 
            if(stockEl) stockEl.textContent = '-'; 
            if(buyEl) buyEl.textContent = '-'; 
            if(sellEl) sellEl.textContent = '-'; 
            return;
        }
        
        if(nameEl) nameEl.textContent = productName;
        
        const history = this.data.filter(t => t.product === productName).sort((a,b) => b.date - a.date);
        const buy = history.find(t => t.type === 'ซื้อ'); 
        const sell = history.find(t => t.type === 'ขาย');
        const stock = history.reduce((acc, t) => t.type === 'ซื้อ' ? acc + t.quantity : acc - t.quantity, 0);
        
        if (stockEl) stockEl.textContent = (Math.round(stock * 100) / 100).toLocaleString();
        if (buyEl) buyEl.textContent = buy ? buy.price.toLocaleString() : '-';
        if (sellEl) sellEl.textContent = sell ? sell.price.toLocaleString() : '-';
    },
    
    saveMultiItems: function(printRequested = false) {
        if (this.isSaving) return; 

        const date = document.getElementById('multi-date').value; 
        const type = document.getElementById('multi-type').value; 
        const items = [];
        
        document.querySelectorAll('.multi-row').forEach(row => {
            const cat = row.querySelector('[name="cat"]').value.trim(); 
            const prod = row.querySelector('[name="prod"]').value.trim(); 
            const price = parseFloat(row.querySelector('[name="price"]').value); 
            const qty = parseFloat(row.querySelector('[name="qty"]').value); 
            const unitInput = row.querySelector('[name="unit"]'); 
            const unit = unitInput ? unitInput.value.trim() : 'ชิ้น';
            
            if(cat && prod && !isNaN(price) && !isNaN(qty)) { 
                items.push({ category: cat, product: prod, price: price, quantity: qty, unit: unit || 'ชิ้น' }); 
            }
        });
        
        if(items.length === 0) { 
            return Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบอย่างน้อย 1 รายการ', 'warning'); 
        }
        
        this.isSaving = true; 
        const btns = document.querySelectorAll('#modal-content button');
        btns.forEach(btn => btn.disabled = true);

        let loadingText = printRequested ? 'กำลังบันทึกและส่งเข้าคิวพริ้นต์...' : 'กำลังบันทึกข้อมูล...';
        Swal.fire({ title: loadingText, allowOutsideClick: false, didOpen: () => { Swal.showLoading() } });
        
        callAPI('saveTransactionBatch', { date, type, items, printRequested }).then(res => {
            this.isSaving = false; 
            btns.forEach(btn => btn.disabled = false);
            Swal.close(); 
            if(res.success) { 
                Swal.fire({ title: 'สำเร็จ!', text: res.message || 'บันทึกข้อมูลเรียบร้อย', icon: 'success', timer: 1500, showConfirmButton: false });
                this.closeMultiModal(); 
                this.fetchData(false); // เรียกดึงข้อมูลใหม่มาแสดงทันทีหลังจากเซฟเสร็จ

                if (res.receiptData) {
                    callAPI('generateBackgroundPDF', res.receiptData).catch(err => console.error(err));
                }
            } else { 
                Swal.fire('เกิดข้อผิดพลาด', res.error || 'ไม่สามารถบันทึกได้', 'error'); 
            }
        }).catch(err => { 
            this.isSaving = false; 
            btns.forEach(btn => btn.disabled = false);
            Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'); 
        });
    },

    sendToCloudPrint: function(data) {
        Swal.fire({ 
            title: 'กำลังส่งเข้าคิวพริ้นต์...', 
            allowOutsideClick: false, 
            didOpen: () => { Swal.showLoading() } 
        });
        
        callAPI('reprintToQueue', data).then(res => {
            if(res.success) {
                Swal.fire({
                    title: 'ส่งเข้าคิวสำเร็จ!',
                    text: 'สลิปจะพิมพ์ออกที่ร้านอัตโนมัติ',
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });
                const printModal = document.getElementById('native-print-modal');
                if (printModal) printModal.remove();
            } else {
                Swal.fire('เกิดข้อผิดพลาด', res.error, 'error');
            }
        }).catch(err => {
            Swal.fire('เกิดข้อผิดพลาด', err.message, 'error');
        });
    },

    showPrintModal: function(data, pdfUrl) {
        let modal = document.getElementById('native-print-modal'); 
        if (modal) modal.remove(); 
        
        modal = document.createElement('div'); 
        modal.id = 'native-print-modal'; 
        modal.className = 'fixed inset-0 bg-slate-900/80 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm transition-opacity';
        
        modal.innerHTML = `
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4 transform transition-all scale-100">
                <h3 class="text-xl font-bold text-center text-slate-800 border-b pb-3 border-slate-100">🧾 จัดการใบเสร็จ (ย้อนหลัง)</h3>
                <div id="pdf-btn-container"></div>
                
                <button onclick="app.sendToCloudPrint(app.lastReceiptData)" class="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg shadow-md hover:bg-indigo-700 transition flex justify-center items-center gap-3">
                    <i class="fa-solid fa-cloud-arrow-up text-2xl"></i> พิมพ์สลิป (ออกเครื่องที่ร้าน)
                </button>

                <button id="btn-print-bt" onclick="app.printWebBluetoothCanvas(app.lastReceiptData)" class="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg shadow-md hover:bg-blue-700 transition flex justify-center items-center gap-3">
                    <i class="fa-brands fa-bluetooth text-2xl"></i> พิมพ์ไร้สาย (Bluetooth มือถือ)
                </button>
                
                <button onclick="document.getElementById('native-print-modal').remove()" class="w-full py-3 mt-2 bg-slate-100 border-2 border-slate-200 text-slate-500 rounded-2xl font-bold hover:bg-slate-200 transition">ปิดหน้าต่าง</button>
            </div>
        `;
        document.body.appendChild(modal);
        
        const pdfContainer = document.getElementById('pdf-btn-container');
        if (pdfUrl) { 
            pdfContainer.innerHTML = `<button onclick="window.open('${pdfUrl}', '_blank')" class="w-full mb-1 py-4 bg-emerald-500 text-white rounded-2xl font-bold text-lg shadow-md hover:bg-emerald-600 transition flex justify-center items-center gap-3"><i class="fa-solid fa-file-pdf text-2xl"></i> ดูบิล (PDF)</button>`; 
        }
        
        app.lastReceiptData = data; 
        modal.classList.remove('hidden');
    },

    printWebBluetoothCanvas: async function(data) {
        try {
            if (!navigator.bluetooth) { 
                alert("เบราว์เซอร์นี้ไม่รองรับการพิมพ์ผ่าน Bluetooth\n\n- หากใช้ PC: ต้องเปิดใช้งาน Bluetooth ในเครื่องและตั้งค่าจับคู่อุปกรณ์\n- หากใช้ มือถือ: ต้องใช้เบราว์เซอร์ Chrome และเปิด GPS ตำแหน่งที่ตั้ง"); 
                return; 
            }
            
            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [ '000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000180a-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb' ]
            });
            
            const printModal = document.getElementById('native-print-modal'); 
            if (printModal) printModal.classList.add('hidden');
            
            Swal.fire({ title: 'กำลังเตรียมบิล...', text: 'ห้ามปิดหน้าจอ', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            const server = await device.gatt.connect(); 
            const services = await server.getPrimaryServices(); 
            let printCharacteristic = null;
            
            for (let service of services) { 
                const characteristics = await service.getCharacteristics(); 
                for (let char of characteristics) { 
                    if (char.properties.writeWithoutResponse || char.properties.write) { 
                        printCharacteristic = char; 
                        break; 
                    } 
                } 
                if (printCharacteristic) break; 
            }
            
            if (!printCharacteristic) throw new Error('ไม่สามารถคุยกับเครื่องปริ้นท์ได้');
            
            const canvas = document.createElement('canvas'); 
            const ctx = canvas.getContext('2d'); 
            const width = 384; 
            canvas.width = width; 
            let currentY = 30; 
            canvas.height = 360 + (data.items.length * 60);
            
            ctx.fillStyle = 'white'; 
            ctx.fillRect(0, 0, canvas.width, canvas.height); 
            ctx.fillStyle = 'black'; 
            ctx.textBaseline = 'top';
            
            ctx.font = 'bold 26px "Sarabun", sans-serif'; 
            ctx.textAlign = 'center'; 
            ctx.fillText("ร้าน บ้านนาค้าของเก่า", width/2, currentY); 
            currentY += 35;
            
            ctx.font = '22px "Sarabun", sans-serif'; 
            ctx.fillText("โทร : 082-447-8795", width/2, currentY); 
            currentY += 40;
            
            ctx.textAlign = 'left'; 
            ctx.fillText("---------------------------------------", 0, currentY); 
            currentY += 25;
            
            ctx.fillText("เลขที่: " + data.receiptNumber, 10, currentY); 
            currentY += 30;
            
            const d = new Date(data.date); 
            ctx.fillText("วันที่: " + d.toLocaleDateString('th-TH') + ' ' + d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}), 10, currentY); 
            currentY += 30;
            
            ctx.fillText("ประเภท: " + data.type, 10, currentY); 
            currentY += 30; 
            
            ctx.fillText("---------------------------------------", 0, currentY); 
            currentY += 25;
            
            ctx.font = 'bold 22px "Sarabun", sans-serif';
            data.items.forEach(item => {
                ctx.textAlign = 'left'; 
                ctx.fillText(item.product, 10, currentY); 
                currentY += 30;
                
                ctx.font = '22px "Sarabun", sans-serif'; 
                ctx.fillText(`  ${item.quantity} ${item.unit} x ${item.price.toLocaleString()}`, 10, currentY);
                
                ctx.textAlign = 'right'; 
                ctx.fillText((item.price * item.quantity).toLocaleString(), width - 10, currentY);
                currentY += 30; 
                
                ctx.font = 'bold 22px "Sarabun", sans-serif';
            });
            
            ctx.textAlign = 'left'; 
            ctx.fillText("---------------------------------------", 0, currentY); 
            currentY += 25;
            
            ctx.font = 'bold 26px "Sarabun", sans-serif'; 
            ctx.fillText("ยอดรวมทั้งสิ้น", 10, currentY);
            
            ctx.textAlign = 'right'; 
            ctx.fillText(data.total.toLocaleString() + " ฿", width - 10, currentY); 
            currentY += 40;
            
            ctx.textAlign = 'left'; 
            ctx.font = '22px "Sarabun", sans-serif'; 
            ctx.fillText("---------------------------------------", 0, currentY); 
            currentY += 30;
            
            ctx.textAlign = 'center'; 
            ctx.fillText("ขอบคุณที่ใช้บริการ", width/2, currentY);
            
            Swal.fire({ title: 'กำลังส่งไปพิมพ์...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height); 
            const pixels = imgData.data; 
            const widthBytes = Math.ceil(canvas.width / 8); 
            const heightDots = canvas.height;
            let bytes = [0x1B, 0x40, 0x1D, 0x76, 0x30, 0x00, widthBytes % 256, Math.floor(widthBytes / 256), heightDots % 256, Math.floor(heightDots / 256)];
            
            for (let y = 0; y < heightDots; y++) {
                for (let xByte = 0; xByte < widthBytes; xByte++) {
                    let byte = 0;
                    for (let bit = 0; bit < 8; bit++) { 
                        let x = xByte * 8 + bit; 
                        if (x < canvas.width && pixels[(y * canvas.width + x) * 4] < 128) { 
                            byte |= (1 << (7 - bit)); 
                        } 
                    }
                    bytes.push(byte);
                }
            }
            
            bytes.push(0x0A, 0x0A, 0x0A);
            let payload = new Uint8Array(bytes); 
            let chunkSize = 120; 
            
            for (let i = 0; i < payload.length; i += chunkSize) { 
                let chunk = payload.slice(i, i + chunkSize); 
                if (printCharacteristic.properties.writeWithoutResponse) { 
                    await printCharacteristic.writeValueWithoutResponse(chunk); 
                } else { 
                    await printCharacteristic.writeValue(chunk); 
                } 
                await new Promise(r => setTimeout(r, 10)); 
            }
            
            setTimeout(() => { 
                if (device.gatt.connected) device.gatt.disconnect(); 
                Swal.fire('พิมพ์สำเร็จ!', '', 'success'); 
            }, 1000);
        } catch (err) {
            console.error(err); 
            Swal.close();
            if (err.name === 'NotFoundError') { 
                return; 
            } else if (err.name === 'SecurityError') { 
                alert('บลูทูธถูกบล็อก! กรุณาอนุญาตสิทธิ์ในเบราว์เซอร์\n(บนมือถือต้องเปิด GPS ด้วยครับ)'); 
            } else { 
                alert('ข้อผิดพลาด:\n' + err.message); 
            }
            
            const printModal = document.getElementById('native-print-modal'); 
            if (printModal) printModal.classList.remove('hidden');
        }
    },
    
    reprintReceipt: function(timestamp, type) {
        const itemsToPrint = this.data.filter(t => t.date === timestamp && t.type === type);
        if(itemsToPrint.length === 0) return;
        
        let grandTotal = 0;
        const formattedItems = itemsToPrint.map(item => { 
            grandTotal += item.total; 
            return { category: item.category, product: item.product, price: item.price, quantity: item.quantity, unit: item.unit }; 
        });
        
        const d = new Date(timestamp);
        const receiptNum = "REC" + d.getFullYear().toString().slice(-2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
        
        this.lastReceiptData = { date: timestamp, type: type, items: formattedItems, total: grandTotal, receiptNumber: receiptNum };
        
        app.showPrintModal(app.lastReceiptData, null); 
    },
    
    openEditModal: function(id) {
        const item = this.data.find(t => t.id === id); 
        if(!item) return;
        
        document.getElementById('edit-id').value = id; 
        const d = new Date(item.date);
        document.getElementById('edit-date').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        document.getElementById('edit-type').value = item.type; 
        document.getElementById('edit-category').value = item.category; 
        document.getElementById('edit-product').value = item.product; 
        document.getElementById('edit-price').value = item.price; 
        document.getElementById('edit-qty').value = item.quantity; 
        document.getElementById('edit-unit').value = item.unit;
        
        document.getElementById('modal-edit').classList.remove('hidden');
    },
    
    saveEditItem: function() {
        const form = { 
            id: document.getElementById('edit-id').value, 
            date: document.getElementById('edit-date').value, 
            type: document.getElementById('edit-type').value, 
            category: document.getElementById('edit-category').value, 
            product: document.getElementById('edit-product').value, 
            price: document.getElementById('edit-price').value, 
            quantity: document.getElementById('edit-qty').value, 
            unit: document.getElementById('edit-unit').value 
        };
        
        Swal.showLoading();
        
        callAPI('updateSingleTransaction', form).then(res => {
            if(res.success) { 
                Swal.fire('สำเร็จ', 'แก้ไขเรียบร้อย', 'success'); 
                document.getElementById('modal-edit').classList.add('hidden'); 
                this.fetchData(false); 
            } else { 
                Swal.fire('Error', res.message, 'error'); 
            }
        }).catch(err => { 
            Swal.fire('Error', err.message, 'error'); 
        });
    },
    
    deleteItem: function(id) {
        Swal.fire({ 
            title: 'ยืนยันลบ?', 
            icon: 'warning', 
            showCancelButton: true, 
            confirmButtonColor: '#f43f5e' 
        }).then((r) => {
            if(r.isConfirmed) { 
                callAPI('deleteTransaction', id).then(res => { 
                    Swal.fire('ลบแล้ว', '', 'success'); 
                    this.fetchData(false); 
                }).catch(err => { 
                    Swal.fire('Error', err.message, 'error'); 
                }); 
            }
        });
    },
    
    renderStock: function() {
        const inv = {}; 
        const stockSearch = document.getElementById('stock-search-input') ? document.getElementById('stock-search-input').value.toLowerCase() : '';
        
        [...this.data].sort((a,b) => new Date(a.date) - new Date(b.date)).forEach(t => {
            const k = t.category + '-' + t.product;
            if(!inv[k]) { 
                inv[k] = { n: t.product, c: t.category, q: 0, u: t.unit, lastBuy:'-', lastSell:'-' }; 
            }
            
            if(t.type === 'ซื้อ') { 
                inv[k].q += t.quantity; 
                inv[k].lastBuy = t.price; 
            } else { 
                inv[k].q -= t.quantity; 
                inv[k].lastSell = t.price; 
            }
            
            inv[k].q = Math.round(inv[k].q * 100) / 100; 
            inv[k].u = t.unit;
        });
        
        const div = document.getElementById('stock-cards'); 
        if(!div) return; 
        div.innerHTML = '';
        
        Object.values(inv).forEach(i => {
            if(stockSearch && !i.n.toLowerCase().includes(stockSearch) && !i.c.toLowerCase().includes(stockSearch)) { return; }
            const isLow = i.q <= 5;
            
            div.innerHTML += `
            <div class="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between group h-full">
                <div>
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider group-hover:text-indigo-600 transition">${i.c}</span>
                        ${isLow ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-600 text-[9px] md:text-[10px] rounded-full font-bold">สินค้าใกล้หมด</span>' : ''}
                    </div>
                    <h3 class="text-sm md:text-lg font-bold text-slate-700 mb-3 line-clamp-2" title="${i.n}">${i.n}</h3>
                </div>
                <div>
                    <div class="flex justify-between items-end mb-3 md:mb-4 pb-3 md:pb-4 border-b border-slate-100 border-dashed">
                        <span class="text-xs md:text-sm text-slate-500 mb-1">คงเหลือ:</span>
                        <div class="text-right">
                            <span class="text-2xl md:text-3xl font-bold ${i.q<0 ? 'text-rose-500' : 'text-slate-800'}">${i.q.toLocaleString()}</span>
                            <span class="text-xs md:text-sm text-slate-400 ml-1">${i.u}</span>
                        </div>
                    </div>
                    <div class="flex justify-between text-[10px] md:text-xs text-slate-500">
                        <div class="flex flex-col">
                            <span class="text-slate-400 mb-1">ซื้อล่าสุด</span>
                            <span class="font-bold text-slate-700 text-[11px] md:text-sm">${i.lastBuy !== '-' ? Number(i.lastBuy).toLocaleString() : '-'} ฿</span>
                        </div>
                        <div class="flex flex-col text-right">
                            <span class="text-slate-400 mb-1">ขายล่าสุด</span>
                            <span class="font-bold text-emerald-600 text-[11px] md:text-sm">${i.lastSell !== '-' ? Number(i.lastSell).toLocaleString() : '-'} ฿</span>
                        </div>
                    </div>
                </div>
            </div>`;
        });
    },
    
    setupListeners: function() {
        const searchInput = document.getElementById('search-input'); 
        if(searchInput) { 
            searchInput.addEventListener('input', () => this.applyFilters()); 
        }
        
        const rowsSelect = document.getElementById('rows-per-page'); 
        if(rowsSelect) { 
            rowsSelect.addEventListener('change', (e) => { 
                this.rowsPerPage=parseInt(e.target.value); 
                this.currentPage=1; 
                this.renderTable(); 
            }); 
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
