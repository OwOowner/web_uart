/**
 * 串口调试工具 - 主要JavaScript逻辑
 * Serial Monitor Pro - Main JavaScript Module
 */

class SerialMonitorPro {
    constructor() {
        this.ports = new Map();
        this.activeConnections = new Set();
        this.dataBuffer = new Map();
        this.isMonitoring = false;
        this.trafficChart = null;
        this.dataRate = 0;
        this.errorCount = 0;
        this.totalData = 0;
        this.lastUpdateTime = Date.now();
        
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.initTrafficChart();
        this.startSystemMonitoring();
        
        // 检查浏览器支持
        if (!('serial' in navigator)) {
            this.showNotification('您的浏览器不支持Web Serial API，请使用Chrome 89+或Edge 89+', 'error');
            return;
        }

        // 自动扫描串口
        await this.scanPorts();
        
        console.log('串口调试工具初始化完成');
    }

    setupEventListeners() {
        // 导航栏按钮
        document.getElementById('scanPorts').addEventListener('click', () => this.scanPorts());
        document.getElementById('connectAll').addEventListener('click', () => this.connectAllPorts());
        document.getElementById('disconnectAll').addEventListener('click', () => this.disconnectAllPorts());
        
        // 数据监控控制
        document.getElementById('clearData').addEventListener('click', () => this.clearMonitor());
        document.getElementById('pauseStream').addEventListener('click', (e) => this.toggleMonitoring(e));
        
        // 快速配置
        const quickConfigs = ['quickBaudRate', 'quickDataBits', 'quickStopBits', 'quickParity'];
        quickConfigs.forEach(id => {
            document.getElementById(id).addEventListener('change', () => this.updateQuickConfig());
        });

        // 数据格式切换
        document.getElementById('dataFormat').addEventListener('change', (e) => {
            this.dataFormat = e.target.value;
            this.updateMonitorDisplay();
        });
    }

    async scanPorts() {
        try {
            this.showNotification('正在扫描串口...', 'info');
            
            // 获取可用串口
            const ports = await navigator.serial.getPorts();
            
            // 更新串口列表显示
            await this.updatePortList(ports);
            
            // 如果没有检测到串口，显示提示
            if (ports.length === 0) {
                this.showNotification('未检测到串口设备，请确保设备已连接并授权访问', 'warning');
            } else {
                this.showNotification(`检测到 ${ports.length} 个串口设备`, 'success');
            }
            
        } catch (error) {
            console.error('扫描串口时出错:', error);
            this.showNotification('扫描串口失败: ' + error.message, 'error');
        }
    }

    async updatePortList(ports) {
        const portList = document.getElementById('portList');
        const portCount = document.getElementById('portCount');
        
        portCount.textContent = ports.length;
        
        if (ports.length === 0) {
            portList.innerHTML = `
                <div class="text-center text-gray-400 py-8">
                    <svg class="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
                    </svg>
                    <p>未检测到串口设备</p>
                    <p class="text-xs mt-2">请连接设备后重新扫描</p>
                </div>
            `;
            return;
        }

        let html = '';
        for (let i = 0; i < ports.length; i++) {
            const port = ports[i];
            const portInfo = await this.getPortInfo(port);
            const isActive = this.activeConnections.has(port);
            
            html += `
                <div class="connection-card rounded-lg p-4 cursor-pointer hover-lift" data-port-index="${i}">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center">
                            <span class="status-indicator ${isActive ? 'status-active pulse-animation' : 'status-inactive'}"></span>
                            <span class="font-medium">${portInfo.name || '未知串口'}</span>
                        </div>
                        <button class="connect-btn px-2 py-1 text-xs rounded ${isActive ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'} transition-colors" 
                                data-port-index="${i}">
                            ${isActive ? '断开' : '连接'}
                        </button>
                    </div>
                    
                    <div class="text-xs text-gray-400 space-y-1">
                        <div>波特率: ${portInfo.baudRate || '自动检测'}</div>
                        <div>状态: ${isActive ? '已连接' : '未连接'}</div>
                        <div>数据: ${this.dataBuffer.get(port)?.length || 0} bytes</div>
                    </div>
                    
                    ${portInfo.vendorId ? `<div class="text-xs text-blue-400">VID: ${portInfo.vendorId}</div>` : ''}
                    ${portInfo.productId ? `<div class="text-xs text-blue-400">PID: ${portInfo.productId}</div>` : ''}
                </div>
            `;
        }
        
        portList.innerHTML = html;
        
        // 添加连接按钮事件监听
        portList.querySelectorAll('.connect-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const portIndex = parseInt(btn.dataset.portIndex);
                this.togglePortConnection(ports[portIndex], btn);
            });
        });
    }

    async getPortInfo(port) {
        try {
            const info = await port.getInfo();
            return {
                name: info.usbProductName || `COM${Math.random().toString(36).substr(2, 3)}`,
                vendorId: info.usbVendorId,
                productId: info.usbProductId,
                baudRate: 115200 // 默认波特率
            };
        } catch (error) {
            console.warn('获取串口信息失败:', error);
            return {
                name: '未知串口',
                baudRate: 115200
            };
        }
    }

    async togglePortConnection(port, button) {
        const isActive = this.activeConnections.has(port);
        
        if (isActive) {
            // 断开连接
            await this.disconnectPort(port);
            button.textContent = '连接';
            button.className = button.className.replace('bg-red-600 hover:bg-red-700', 'bg-green-600 hover:bg-green-700');
        } else {
            // 连接串口
            const success = await this.connectPort(port);
            if (success) {
                button.textContent = '断开';
                button.className = button.className.replace('bg-green-600 hover:bg-green-700', 'bg-red-600 hover:bg-red-700');
            }
        }
        
        this.updateStats();
    }

    async connectPort(port) {
        try {
            const baudRate = parseInt(document.getElementById('quickBaudRate').value);
            const dataBits = parseInt(document.getElementById('quickDataBits').value);
            const stopBits = parseInt(document.getElementById('quickStopBits').value);
            const parity = document.getElementById('quickParity').value;

            await port.open({
                baudRate: baudRate,
                dataBits: dataBits,
                stopBits: stopBits,
                parity: parity,
                flowControl: 'none'
            });

            this.activeConnections.add(port);
            this.dataBuffer.set(port, []);
            
            this.showNotification(`串口连接成功 (${baudRate}bps)`, 'success');
            this.startReadingPort(port);
            
            return true;
            
        } catch (error) {
            console.error('连接串口失败:', error);
            this.showNotification('串口连接失败: ' + error.message, 'error');
            return false;
        }
    }

    async disconnectPort(port) {
        try {
            await port.close();
            this.activeConnections.delete(port);
            this.dataBuffer.delete(port);
            this.showNotification('串口已断开', 'info');
        } catch (error) {
            console.error('断开串口失败:', error);
            this.showNotification('断开串口失败: ' + error.message, 'error');
        }
    }

    async connectAllPorts() {
        const ports = await navigator.serial.getPorts();
        let connectedCount = 0;
        
        for (const port of ports) {
            if (!this.activeConnections.has(port)) {
                const success = await this.connectPort(port);
                if (success) connectedCount++;
                
                // 添加延迟避免同时连接多个串口造成冲突
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        if (connectedCount > 0) {
            this.showNotification(`成功连接 ${connectedCount} 个串口`, 'success');
            await this.updatePortList(ports);
        } else {
            this.showNotification('没有可连接的串口', 'warning');
        }
    }

    async disconnectAllPorts() {
        const ports = Array.from(this.activeConnections);
        let disconnectedCount = 0;
        
        for (const port of ports) {
            await this.disconnectPort(port);
            disconnectedCount++;
        }
        
        if (disconnectedCount > 0) {
            this.showNotification(`已断开 ${disconnectedCount} 个串口`, 'info');
            const availablePorts = await navigator.serial.getPorts();
            await this.updatePortList(availablePorts);
        }
    }

    async startReadingPort(port) {
        if (!port.readable) return;
        
        const reader = port.readable.getReader();
        const buffer = this.dataBuffer.get(port) || [];
        
        try {
            while (this.activeConnections.has(port)) {
                const { value, done } = await reader.read();
                
                if (done) break;
                
                if (value) {
                    buffer.push(...value);
                    this.totalData += value.length;
                    
                    // 限制缓冲区大小
                    if (buffer.length > 10000) {
                        buffer.splice(0, buffer.length - 10000);
                    }
                    
                    // 更新显示
                    this.updateMonitorDisplay();
                    this.updateTrafficChart();
                }
            }
        } catch (error) {
            console.error('读取串口数据失败:', error);
            this.errorCount++;
            this.showNotification('串口数据读取错误: ' + error.message, 'error');
        } finally {
            reader.releaseLock();
        }
    }

    updateMonitorDisplay() {
        const monitor = document.getElementById('dataMonitor');
        const format = document.getElementById('dataFormat').value;
        
        if (this.activeConnections.size === 0) {
            monitor.innerHTML = `
                <div class="text-gray-500 text-center py-8">
                    <svg class="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                    </svg>
                    <p>等待串口连接...</p>
                    <p class="text-xs mt-2">连接串口后将在此显示实时数据</p>
                </div>
            `;
            return;
        }
        
        let html = '';
        let totalPackets = 0;
        
        for (const [port, data] of this.dataBuffer) {
            if (data.length === 0) continue;
            
            totalPackets++;
            const portInfo = this.ports.get(port) || { name: '未知串口' };
            const timestamp = new Date().toLocaleTimeString();
            
            let formattedData = '';
            switch (format) {
                case 'hex':
                    formattedData = data.slice(-50).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
                    break;
                case 'binary':
                    formattedData = data.slice(-50).map(b => b.toString(2).padStart(8, '0')).join(' ');
                    break;
                default:
                    formattedData = data.slice(-50).map(b => {
                        const char = String.fromCharCode(b);
                        return b >= 32 && b <= 126 ? char : '.';
                    }).join('');
            }
            
            html += `
                <div class="data-packet mb-2">
                    <div class="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>[${timestamp}] ${portInfo.name}</span>
                        <span class="text-blue-400">${data.length} bytes</span>
                    </div>
                    <div class="text-green-400 font-mono text-xs break-all">${formattedData}</div>
                </div>
            `;
        }
        
        if (html === '') {
            html = `
                <div class="text-gray-500 text-center py-4">
                    <p>等待数据...</p>
                </div>
            `;
        }
        
        monitor.innerHTML = html;
        
        // 自动滚动到底部
        monitor.scrollTop = monitor.scrollHeight;
    }

    clearMonitor() {
        for (const port of this.dataBuffer.keys()) {
            this.dataBuffer.set(port, []);
        }
        this.updateMonitorDisplay();
        this.showNotification('监控数据已清空', 'info');
    }

    toggleMonitoring(button) {
        this.isMonitoring = !this.isMonitoring;
        button.textContent = this.isMonitoring ? '暂停' : '继续';
        button.className = this.isMonitoring ? 
            'px-3 py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-sm transition-colors' :
            'px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm transition-colors';
    }

    initTrafficChart() {
        const chartDom = document.getElementById('trafficChart');
        this.trafficChart = echarts.init(chartDom);
        
        const option = {
            backgroundColor: 'transparent',
            grid: {
                left: '10%',
                right: '10%',
                top: '10%',
                bottom: '20%'
            },
            xAxis: {
                type: 'category',
                data: [],
                axisLine: { lineStyle: { color: '#4a5568' } },
                axisLabel: { color: '#a0aec0', fontSize: 10 }
            },
            yAxis: {
                type: 'value',
                axisLine: { lineStyle: { color: '#4a5568' } },
                axisLabel: { color: '#a0aec0', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2d3748' } }
            },
            series: [{
                data: [],
                type: 'line',
                smooth: true,
                lineStyle: { color: '#74b9ff', width: 2 },
                areaStyle: {
                    color: {
                        type: 'linear',
                        x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(116, 185, 255, 0.3)' },
                            { offset: 1, color: 'rgba(116, 185, 255, 0.05)' }
                        ]
                    }
                },
                symbol: 'none'
            }]
        };
        
        this.trafficChart.setOption(option);
    }

    updateTrafficChart() {
        if (!this.trafficChart) return;
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString();
        const currentRate = this.calculateDataRate();
        
        const option = this.trafficChart.getOption();
        const xData = option.xAxis[0].data;
        const yData = option.series[0].data;
        
        // 保持最近20个数据点
        if (xData.length >= 20) {
            xData.shift();
            yData.shift();
        }
        
        xData.push(timeStr);
        yData.push(currentRate);
        
        this.trafficChart.setOption({
            xAxis: { data: xData },
            series: [{ data: yData }]
        });
    }

    calculateDataRate() {
        const now = Date.now();
        const timeDiff = (now - this.lastUpdateTime) / 1000; // 转换为秒
        
        if (timeDiff > 0) {
            const rate = this.totalData / timeDiff;
            this.dataRate = rate;
            this.lastUpdateTime = now;
            this.totalData = 0;
            
            // 更新显示
            const rateElement = document.getElementById('dataRate');
            if (rateElement) {
                rateElement.textContent = this.formatBytes(rate) + '/s';
            }
            
            return rate;
        }
        
        return this.dataRate;
    }

    updateStats() {
        const activeConnectionsElement = document.getElementById('activeConnections');
        const errorRateElement = document.getElementById('errorRate');
        
        if (activeConnectionsElement) {
            activeConnectionsElement.textContent = this.activeConnections.size;
        }
        
        if (errorRateElement) {
            const totalOperations = this.activeConnections.size + this.errorCount;
            const errorRate = totalOperations > 0 ? (this.errorCount / totalOperations * 100).toFixed(1) : 0;
            errorRateElement.textContent = errorRate + '%';
        }
    }

    updateQuickConfig() {
        // 这里可以实现快速配置应用到所有连接的串口
        this.showNotification('配置已更新', 'info');
    }

    startSystemMonitoring() {
        // 更新系统状态
        setInterval(() => {
            const now = new Date();
            const timeStr = now.toLocaleTimeString();
            
            document.getElementById('lastUpdate').textContent = timeStr;
            
            // 模拟内存使用
            const memoryUsage = Math.floor(Math.random() * 50) + 20;
            document.getElementById('memoryUsage').textContent = `内存: ${memoryUsage} MB`;
            
            // 更新统计信息
            this.updateStats();
            
        }, 1000);
        
        // 定期更新流量图表
        setInterval(() => {
            this.updateTrafficChart();
        }, 2000);
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    showNotification(message, type = 'info') {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `fixed top-24 right-6 z-50 px-6 py-4 rounded-lg shadow-lg transition-all duration-300 transform translate-x-full`;
        
        // 根据类型设置样式
        const styles = {
            success: 'bg-green-600 text-white',
            error: 'bg-red-600 text-white',
            warning: 'bg-yellow-600 text-white',
            info: 'bg-blue-600 text-white'
        };
        
        notification.className += ` ${styles[type] || styles.info}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // 显示动画
        setTimeout(() => {
            notification.classList.remove('translate-x-full');
        }, 100);
        
        // 自动隐藏
        setTimeout(() => {
            notification.classList.add('translate-x-full');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.serialMonitor = new SerialMonitorPro();
    
    // 添加页面动画效果
    anime({
        targets: '.glass-effect',
        opacity: [0, 1],
        translateY: [20, 0],
        delay: anime.stagger(100),
        duration: 800,
        easing: 'easeOutQuart'
    });
    
    // 标题动画
    anime({
        targets: '.title-font',
        opacity: [0, 1],
        scale: [0.8, 1],
        duration: 1000,
        easing: 'easeOutElastic(1, .8)'
    });
});

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
    if (window.serialMonitor) {
        window.serialMonitor.disconnectAllPorts();
    }
});