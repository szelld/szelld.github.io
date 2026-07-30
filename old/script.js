// ========================================
// MQTT Configuration
// ========================================
// Change this to your MQTT broker URL (WebSocket protocol)
// For local mosquitto broker: 'ws://YOUR_ESP32_IP:9001'
// For HiveMQ public broker: 'wss://broker.hivemq.com:8884/mqtt'
// For Mosquitto public broker: 'wss://test.mosquitto.org:8081'
const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const MQTT_OPTIONS = {
    clientId: 'smarthome_web_' + Math.random().toString(16).substr(2, 8),
    clean: true,
    reconnectPeriod: 1000,
};

// MQTT Topics
const TOPICS = {
    // Lights
    LIGHT_LIVING: 'home/living/light',
    LIGHT_BEDROOM: 'home/bedroom/light',
    LIGHT_BATHROOM: 'home/bathroom/light',
    LIGHT_KITCHEN: 'home/kitchen/light',
    LIGHT_ENTRY: 'home/entry/light',
    LIGHT_WORK: 'home/work/light',
    LIGHT_GARAGE: 'home/garage/light',
    
    // Bedroom sensors
    TEMP_BEDROOM: 'home/bedroom/temperature',
    HUMIDITY_BEDROOM: 'home/bedroom/humidity',
    MOTION_BEDROOM: 'home/bedroom/motion',
    FAN_BEDROOM: 'home/bedroom/fan',
    
    // Garage
    GARAGE_DOOR: 'home/garage/door',
    CAR_DETECT: 'home/garage/car',
    CAR_DISTANCE: 'home/garage/distance',  // Ultrasonic distance in cm
    DOOR_SENSOR: 'home/garage/doorsensor',
    
    // General
    BRIGHTNESS: 'home/general/brightness',
    
    // Security
    SECURITY_PIN: 'home/security/pin',
    SECURITY_LOCK: 'home/security/lock',
    SECURITY_STATUS: 'home/security/status',
    SECURITY_ALARM: 'home/security/alarm',
};

// ========================================
// Global Variables
// ========================================
let mqttClient = null;
let tempChart, humidityChart, brightnessChart;
let tempData = [], humidityData = [], brightnessData = [];
let timeLabels = [];
const MAX_DATA_POINTS = 20;

// Throttle chart updates to prevent flooding - separate for each chart
let lastTempUpdate = 0;
let lastHumidityUpdate = 0;
let lastBrightnessUpdate = 0;
const CHART_UPDATE_INTERVAL = 1000; // Minimum 1 second between chart updates

// Security System Variables
let currentPIN = '';
let isHouseLocked = false;

// ========================================
// Initialize on page load
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('Smart Home Control System Initializing...');
    initCharts();
    initMQTT();
    initControls();
    initSecurityKeypad();
    loadHistoricalData();
});

// ========================================
// MQTT Connection
// ========================================
function initMQTT() {
    updateConnectionStatus('Connecting...', false);
    
    try {
        mqttClient = mqtt.connect(MQTT_BROKER, MQTT_OPTIONS);
        
        mqttClient.on('connect', () => {
            console.log('✅ Connected to MQTT broker');
            updateConnectionStatus('Connected', true);
            subscribeToTopics();
        });
        
        mqttClient.on('message', handleMQTTMessage);
        
        mqttClient.on('error', (error) => {
            console.error('❌ MQTT Error:', error);
            updateConnectionStatus('Error', false);
        });
        
        mqttClient.on('offline', () => {
            console.log('📡 MQTT Offline');
            updateConnectionStatus('Offline', false);
        });
        
        mqttClient.on('reconnect', () => {
            console.log('🔄 MQTT Reconnecting...');
            updateConnectionStatus('Reconnecting...', false);
        });
        
    } catch (error) {
        console.error('Failed to initialize MQTT:', error);
        updateConnectionStatus('Failed', false);
    }
}

function subscribeToTopics() {
    Object.values(TOPICS).forEach(topic => {
        mqttClient.subscribe(topic, (err) => {
            if (err) {
                console.error(`Failed to subscribe to ${topic}:`, err);
            } else {
                console.log(`📨 Subscribed to ${topic}`);
            }
        });
    });
}

function updateConnectionStatus(text, isConnected) {
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.getElementById('statusIndicator');
    
    if (statusText) statusText.textContent = text;
    if (statusIndicator) {
        statusIndicator.classList.toggle('connected', isConnected);
    }
}

// ========================================
// MQTT Message Handler
// ========================================
function handleMQTTMessage(topic, message) {
    const payload = message.toString();
    console.log(`📩 ${topic}: ${payload}`);
    
    try {
        switch (topic) {
            // Lights
            case TOPICS.LIGHT_LIVING:
                updateLightState('living', payload);
                break;
            case TOPICS.LIGHT_BEDROOM:
                updateLightState('bedroom', payload);
                break;
            case TOPICS.LIGHT_BATHROOM:
                updateLightState('bathroom', payload);
                break;
            case TOPICS.LIGHT_KITCHEN:
                updateLightState('kitchen', payload);
                break;
            case TOPICS.LIGHT_ENTRY:
                updateLightState('entry', payload);
                break;
            case TOPICS.LIGHT_WORK:
                updateLightState('work', payload);
                break;
            case TOPICS.LIGHT_GARAGE:
                updateLightState('garage', payload);
                break;
            
            // Bedroom sensors
            case TOPICS.TEMP_BEDROOM:
                updateTemperature(parseFloat(payload));
                break;
            case TOPICS.HUMIDITY_BEDROOM:
                updateHumidity(parseFloat(payload));
                break;
            case TOPICS.MOTION_BEDROOM:
                updateMotion(payload === '1' || payload.toLowerCase() === 'true');
                break;
            case TOPICS.FAN_BEDROOM:
                updateFanState(payload);
                break;
            
            // Garage
            case TOPICS.GARAGE_DOOR:
                updateGarageDoor(payload);
                break;
            case TOPICS.CAR_DETECT:
                updateCarDetection(payload === '1' || payload.toLowerCase() === 'true');
                break;
            case TOPICS.CAR_DISTANCE:
                updateCarDistance(parseInt(payload));
                break;
            case TOPICS.DOOR_SENSOR:
                updateDoorSensor(payload === '1' || payload.toLowerCase() === 'true');
                break;
            
            // Brightness
            case TOPICS.BRIGHTNESS:
                updateBrightness(parseFloat(payload));
                break;
            
            // Security
            case TOPICS.SECURITY_STATUS:
                updateSecurityStatus(payload);
                break;
            case TOPICS.SECURITY_ALARM:
                updateAlarmStatus(payload === '1' || payload.toLowerCase() === 'true');
                break;
        }
    } catch (error) {
        console.error('Error handling message:', error);
    }
}

// ========================================
// Publish MQTT Messages
// ========================================
function publishMessage(topic, message) {
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(topic, message.toString(), (err) => {
            if (err) {
                console.error(`Failed to publish to ${topic}:`, err);
            } else {
                console.log(`📤 Published to ${topic}: ${message}`);
            }
        });
    } else {
        console.warn('MQTT not connected. Cannot publish message.');
    }
}

// ========================================
// UI Update Functions
// ========================================
function updateLightState(room, state) {
    const isOn = state === '1' || state.toLowerCase() === 'on';
    const btn = document.getElementById(`btn-light-${room}`);
    const indicator = document.getElementById(`light-${room}`);
    
    if (btn) {
        btn.dataset.state = isOn ? 'on' : 'off';
        btn.textContent = isOn ? 'ON' : 'OFF';
    }
    
    if (indicator) {
        indicator.classList.toggle('on', isOn);
    }
}

function updateTemperature(temp) {
    const tempElement = document.getElementById('temp-bedroom');
    if (tempElement) {
        tempElement.textContent = `${temp.toFixed(1)}°C`;
    }
    addDataPoint(tempData, temp, tempChart, 'temp');
    saveToLocalStorage('temperature', temp);
}

function updateHumidity(humidity) {
    const humidityElement = document.getElementById('humidity-bedroom');
    if (humidityElement) {
        humidityElement.textContent = `${humidity.toFixed(1)}%`;
    }
    addDataPoint(humidityData, humidity, humidityChart, 'humidity');
    saveToLocalStorage('humidity', humidity);
}

function updateMotion(detected) {
    const motionElement = document.getElementById('motion-bedroom');
    if (motionElement) {
        motionElement.textContent = detected ? 'Motion Detected!' : 'No Motion';
        motionElement.classList.toggle('detected', detected);
    }
}

function updateFanState(state) {
    const isOn = state === '1' || state.toLowerCase() === 'on';
    const btn = document.getElementById('btn-fan-bedroom');
    if (btn) {
        btn.dataset.state = isOn ? 'on' : 'off';
        btn.textContent = isOn ? 'ON' : 'OFF';
    }
}

function updateGarageDoor(state) {
    const isOpen = state === '1' || state.toLowerCase() === 'open';
    const btn = document.getElementById('btn-door-garage');
    if (btn) {
        btn.dataset.state = isOpen ? 'open' : 'closed';
        btn.textContent = isOpen ? 'OPEN' : 'CLOSED';
    }
}

function updateCarDetection(detected) {
    const carIndicator = document.getElementById('carIndicator');
    const carStatus = document.getElementById('car-status');
    
    if (carIndicator) {
        carIndicator.style.display = detected ? 'block' : 'none';
    }
    if (carStatus) {
        carStatus.textContent = detected ? 'Detected' : 'Not Detected';
        carStatus.style.color = detected ? '#00b894' : '#636e72';
    }
}

function updateCarDistance(distance) {
    const distanceElement = document.getElementById('car-distance');
    
    if (distanceElement) {
        if (distance < 0) {
            distanceElement.textContent = 'No Echo';
        } else {
            distanceElement.textContent = `${distance} cm`;
        }
    }
}

function updateDoorSensor(isOpen) {
    const doorSensor = document.getElementById('door-sensor');
    if (doorSensor) {
        doorSensor.textContent = isOpen ? 'Open' : 'Closed';
        doorSensor.style.color = isOpen ? '#d63031' : '#00b894';
    }
}

function updateBrightness(brightness) {
    const brightnessElement = document.getElementById('brightness-current');
    const brightnessFill = document.getElementById('brightness-fill');
    
    if (brightnessElement) {
        brightnessElement.textContent = `${brightness.toFixed(0)} lux`;
    }
    
    if (brightnessFill) {
        const percentage = Math.min((brightness / 1000) * 100, 100);
        brightnessFill.style.width = `${percentage}%`;
    }
    
    addDataPoint(brightnessData, brightness, brightnessChart, 'brightness');
    saveToLocalStorage('brightness', brightness);
}

// ========================================
// Control Initialization
// ========================================
function initControls() {
    // Light controls
    setupToggleButton('btn-light-living', TOPICS.LIGHT_LIVING);
    setupToggleButton('btn-light-bedroom', TOPICS.LIGHT_BEDROOM);
    setupToggleButton('btn-light-bathroom', TOPICS.LIGHT_BATHROOM);
    setupToggleButton('btn-light-kitchen', TOPICS.LIGHT_KITCHEN);
    setupToggleButton('btn-light-entry', TOPICS.LIGHT_ENTRY);
    setupToggleButton('btn-light-work', TOPICS.LIGHT_WORK);
    setupToggleButton('btn-light-garage', TOPICS.LIGHT_GARAGE);
    
    // Fan control
    setupToggleButton('btn-fan-bedroom', TOPICS.FAN_BEDROOM);
    
    // Garage door control
    setupToggleButton('btn-door-garage', TOPICS.GARAGE_DOOR);
    
    // Room overlay clicks
    document.querySelectorAll('.room-overlay').forEach(room => {
        room.addEventListener('click', (e) => {
            const roomName = e.target.dataset.room;
            const btn = document.getElementById(`btn-light-${roomName}`);
            
            // Debug info
            const debugRoom = document.getElementById('debugRoom');
            const debugStatus = document.getElementById('debugStatus');
            if (debugRoom) {
                const roomNames = {
                    'living': '🛋️ Living Room',
                    'bedroom': '🛏️ Bedroom',
                    'bathroom': '🚿 Bathroom',
                    'kitchen': '🍳 Kitchen',
                    'entry': '🚪 Entry Room',
                    'work': '💼 Work Room',
                    'garage': '🚗 Garage'
                };
                debugRoom.textContent = roomNames[roomName] || roomName;
                debugRoom.style.color = '#00b894';
            }
            if (debugStatus) {
                if (btn) {
                    debugStatus.textContent = `Button found! ID: btn-light-${roomName} | Current state: ${btn.dataset.state}`;
                    debugStatus.style.color = '#00b894';
                } else {
                    debugStatus.textContent = `⚠️ Button NOT found! Expected ID: btn-light-${roomName}`;
                    debugStatus.style.color = '#e74c3c';
                }
            }
            
            if (btn) btn.click();
        });
    });
}

function setupToggleButton(buttonId, topic) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    btn.addEventListener('click', () => {
        const currentState = btn.dataset.state;
        let newState;
        
        if (currentState === 'off' || currentState === 'closed') {
            newState = buttonId.includes('door') ? 'open' : 'on';
        } else {
            newState = buttonId.includes('door') ? 'closed' : 'off';
        }
        
        publishMessage(topic, newState === 'on' || newState === 'open' ? '1' : '0');
    });
}

// ========================================
// Chart.js Initialization
// ========================================
function initCharts() {
    const chartConfig = (label, color, data) => ({
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: label,
                data: data,
                borderColor: color,
                backgroundColor: color + '33',
                tension: 0.4,
                fill: true,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: false
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
    
    tempChart = new Chart(
        document.getElementById('tempChart').getContext('2d'),
        chartConfig('Temperature', '#e74c3c', tempData)
    );
    
    humidityChart = new Chart(
        document.getElementById('humidityChart').getContext('2d'),
        chartConfig('Humidity', '#3498db', humidityData)
    );
    
    brightnessChart = new Chart(
        document.getElementById('brightnessChart').getContext('2d'),
        chartConfig('Brightness', '#f39c12', brightnessData)
    );
}

function addDataPoint(dataArray, value, chart, chartType) {
    const now = Date.now();
    
    // Get the correct throttle variable based on chart type
    let lastUpdate, shouldUpdate;
    
    if (chartType === 'temp') {
        shouldUpdate = (now - lastTempUpdate >= CHART_UPDATE_INTERVAL);
        if (shouldUpdate) lastTempUpdate = now;
    } else if (chartType === 'humidity') {
        shouldUpdate = (now - lastHumidityUpdate >= CHART_UPDATE_INTERVAL);
        if (shouldUpdate) lastHumidityUpdate = now;
    } else if (chartType === 'brightness') {
        shouldUpdate = (now - lastBrightnessUpdate >= CHART_UPDATE_INTERVAL);
        if (shouldUpdate) lastBrightnessUpdate = now;
    }
    
    if (!shouldUpdate) {
        console.log(`⏱️ Throttling ${chartType} chart update`);
        return; // Skip this update
    }
    
    const timeString = new Date().toLocaleTimeString();
    
    if (timeLabels.length === 0 || timeLabels[timeLabels.length - 1] !== timeString) {
        timeLabels.push(timeString);
        if (timeLabels.length > MAX_DATA_POINTS) {
            timeLabels.shift();
        }
    }
    
    dataArray.push(value);
    if (dataArray.length > MAX_DATA_POINTS) {
        dataArray.shift();
    }
    
    console.log(`📊 Updating ${chartType} chart with value: ${value}`);
    chart.update();
}

// ========================================
// Local Storage for Historical Data
// ========================================
function saveToLocalStorage(key, value) {
    try {
        const history = JSON.parse(localStorage.getItem(key) || '[]');
        history.push({
            timestamp: new Date().toISOString(),
            value: value
        });
        
        // Keep only last 100 entries
        if (history.length > 100) {
            history.shift();
        }
        
        localStorage.setItem(key, JSON.stringify(history));
    } catch (error) {
        console.error('Error saving to localStorage:', error);
    }
}

function loadHistoricalData() {
    try {
        ['temperature', 'humidity', 'brightness'].forEach(key => {
            const history = JSON.parse(localStorage.getItem(key) || '[]');
            const recent = history.slice(-MAX_DATA_POINTS);
            
            recent.forEach(entry => {
                const time = new Date(entry.timestamp).toLocaleTimeString();
                if (!timeLabels.includes(time)) {
                    timeLabels.push(time);
                }
                
                if (key === 'temperature') tempData.push(entry.value);
                if (key === 'humidity') humidityData.push(entry.value);
                if (key === 'brightness') brightnessData.push(entry.value);
            });
        });
        
        if (tempChart) tempChart.update();
        if (humidityChart) humidityChart.update();
        if (brightnessChart) brightnessChart.update();
        
        console.log('📊 Historical data loaded from localStorage');
    } catch (error) {
        console.error('Error loading historical data:', error);
    }
}

// ========================================
// Security System Functions
// ========================================
function initSecurityKeypad() {
    console.log('🔐 Initializing security keypad...');
    
    // Keypad digit buttons
    const keypadButtons = document.querySelectorAll('.keypad-btn');
    console.log(`Found ${keypadButtons.length} keypad buttons`);
    
    keypadButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const digit = btn.getAttribute('data-digit');
            console.log(`Keypad button pressed: ${digit}`);
            handleKeypadInput(digit);
        });
    });

    // Lock button
    const lockBtn = document.getElementById('btn-lock');
    if (lockBtn) {
        lockBtn.addEventListener('click', toggleLock);
        console.log('✓ Lock button initialized');
    } else {
        console.error('❌ Lock button not found!');
    }
    
    console.log('✓ Security keypad initialized');
}

function handleKeypadInput(input) {
    const pinDisplay = document.getElementById('pin-display');
    const pinFeedback = document.getElementById('pin-feedback');
    
    console.log(`🔐 Keypad input: ${input}, Current PIN length: ${currentPIN.length}`);
    
    if (input === 'clear') {
        currentPIN = '';
        pinDisplay.value = '';
        pinFeedback.textContent = '';
        pinFeedback.className = 'pin-feedback';
        console.log('PIN cleared');
    } else if (input === 'enter') {
        if (currentPIN.length === 4) {
            console.log('Enter pressed - submitting PIN');
            submitPIN();
        } else {
            pinFeedback.textContent = 'PIN must be 4 digits';
            pinFeedback.className = 'pin-feedback error';
            console.log(`PIN too short: ${currentPIN.length} digits`);
        }
    } else {
        // Add digit to PIN (max 4 digits)
        if (currentPIN.length < 4) {
            currentPIN += input;
            pinDisplay.value = '•'.repeat(currentPIN.length);
            console.log(`Added digit, PIN now ${currentPIN.length} digits`);
            
            // Auto-submit when 4 digits entered
            if (currentPIN.length === 4) {
                console.log('4 digits entered - auto-submitting');
                setTimeout(() => submitPIN(), 300);
            }
        }
    }
}

function submitPIN() {
    const pinFeedback = document.getElementById('pin-feedback');
    
    if (!mqttClient || !mqttClient.connected) {
        pinFeedback.textContent = 'Not connected to MQTT';
        pinFeedback.className = 'pin-feedback error';
        console.error('MQTT not connected');
        return;
    }
    
    console.log(`🔐 Submitting PIN: ${currentPIN} to topic: ${TOPICS.SECURITY_PIN}`);
    
    mqttClient.publish(TOPICS.SECURITY_PIN, currentPIN, { qos: 1 }, (err) => {
        if (err) {
            console.error('Failed to publish PIN:', err);
            pinFeedback.textContent = 'Failed to send';
            pinFeedback.className = 'pin-feedback error';
        } else {
            console.log('✓ PIN published successfully');
        }
    });
    
    pinFeedback.textContent = 'Verifying...';
    pinFeedback.className = 'pin-feedback';
    
    // Clear PIN after submission
    setTimeout(() => {
        currentPIN = '';
        document.getElementById('pin-display').value = '';
    }, 500);
}

function toggleLock() {
    if (!mqttClient || !mqttClient.connected) {
        alert('Not connected to MQTT');
        console.error('MQTT not connected');
        return;
    }
    
    // Only allow locking, not unlocking (unlocking requires PIN)
    if (isHouseLocked) {
        alert('❌ Cannot unlock with button! Please enter PIN code.');
        return;
    }
    
    // Lock the house
    console.log(`🔐 Locking house - Publishing to: ${TOPICS.SECURITY_LOCK}`);
    
    mqttClient.publish(TOPICS.SECURITY_LOCK, '1', { qos: 1 }, (err) => {
        if (err) {
            console.error('Failed to publish lock command:', err);
        } else {
            console.log('✓ Lock command published: 1');
        }
    });
}

function updateSecurityStatus(status) {
    const lockStatusEl = document.getElementById('lock-status');
    const lockBtn = document.getElementById('btn-lock');
    const pinFeedback = document.getElementById('pin-feedback');
    
    if (status === 'locked') {
        isHouseLocked = true;
        lockStatusEl.textContent = 'LOCKED';
        lockStatusEl.className = 'status-locked';
        lockBtn.textContent = '🔒 Locked (Use PIN to unlock)';
        lockBtn.classList.add('locked');
        lockBtn.disabled = true;  // Disable button when locked
        console.log('🔒 House is now LOCKED');
    } else if (status === 'unlocked') {
        isHouseLocked = false;
        lockStatusEl.textContent = 'UNLOCKED';
        lockStatusEl.className = 'status-unlocked';
        lockBtn.textContent = '🔒 Lock House';
        lockBtn.classList.remove('locked');
        lockBtn.disabled = false;  // Enable button when unlocked
        console.log('🔓 House is now UNLOCKED');
        
        // Show success feedback
        pinFeedback.textContent = '✓ Unlocked successfully';
        pinFeedback.className = 'pin-feedback success';
        setTimeout(() => {
            pinFeedback.textContent = '';
            pinFeedback.className = 'pin-feedback';
        }, 3000);
    } else if (status === 'incorrect_pin') {
        pinFeedback.textContent = '✗ Incorrect PIN';
        pinFeedback.className = 'pin-feedback error';
        setTimeout(() => {
            pinFeedback.textContent = '';
            pinFeedback.className = 'pin-feedback';
        }, 3000);
    }
}

function updateAlarmStatus(isActive) {
    const alarmStatusEl = document.getElementById('alarm-status');
    
    if (isActive) {
        alarmStatusEl.textContent = 'TRIGGERED!';
        alarmStatusEl.className = 'alarm-on';
        console.log('🚨 ALARM TRIGGERED!');
    } else {
        alarmStatusEl.textContent = 'OFF';
        alarmStatusEl.className = 'alarm-off';
    }
}