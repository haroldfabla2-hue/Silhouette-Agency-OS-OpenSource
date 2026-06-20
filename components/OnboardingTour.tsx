import React, { useEffect } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

export const OnboardingTour: React.FC = () => {
    useEffect(() => {
        // Run tour if not completed
        const tourCompleted = localStorage.getItem('silhouette_tour_completed');
        if (tourCompleted === 'true') return;

        // Small delay to ensure DOM is fully loaded and initialized
        const timer = setTimeout(() => {
            const driverObj = driver({
                showProgress: true,
                animate: true,
                popoverClass: 'driverjs-theme',
                steps: [
                    {
                        popover: {
                            title: '⚡ ¡Bienvenido a Silhouette Agency OS!',
                            description: 'Este es el sistema operativo cognitivo diseñado para automatizar tu agencia mediante colmenas de agentes inteligentes. Vamos a realizar un breve recorrido.'
                        }
                    },
                    {
                        element: '#sidebar-tab-dashboard',
                        popover: {
                            title: '🛸 Centro de Control',
                            description: 'Tu panel general para monitorear ráfagas de tokens, estado de la red, VRAM y la coherencia general del sistema cognitivo.',
                            side: 'right',
                            align: 'start'
                        }
                    },
                    {
                        element: '#tour-metrics-grid',
                        popover: {
                            title: '📊 Métricas en Tiempo Real',
                            description: 'Monitorea la carga neural, consumo de memoria VRAM, uso de tokens y el rendimiento físico del hardware local.',
                            side: 'bottom',
                            align: 'start'
                        }
                    },
                    {
                        element: '#tour-mission-control',
                        popover: {
                            title: '🎯 Control de Misiones',
                            description: 'Envía instrucciones directas o briefs a tu colmena. Por ejemplo: "Investiga tendencias de mercado para mi marca". Los agentes se auto-organizarán para resolverlo.',
                            side: 'top',
                            align: 'start'
                        }
                    },
                    {
                        element: '#tour-token-velocity',
                        popover: {
                            title: '📈 Velocidad de Tokens',
                            description: 'Monitorea el flujo de llamadas de lenguaje (LLM) y la latencia del procesado inteligente local y en la nube.',
                            side: 'left',
                            align: 'start'
                        }
                    },
                    {
                        element: '#sidebar-tab-orchestrator',
                        popover: {
                            title: '🐝 Colmena de Agentes',
                            description: 'Aquí puedes ver el pensamiento distribuido de cada agente activo, sus logs cognitivos y sus misiones individuales.',
                            side: 'right',
                            align: 'start'
                        }
                    },
                    {
                        element: '#chat-toggle-btn',
                        popover: {
                            title: '💬 Terminal de Chat',
                            description: 'Haz clic aquí en cualquier momento para hablar directamente con Silhouette, adjuntar archivos o ejecutar comandos locales.',
                            side: 'left',
                            align: 'end'
                        }
                    },
                    {
                        element: '#sidebar-tab-settings',
                        popover: {
                            title: '⚙️ Configuración del Núcleo',
                            description: 'Ajusta tus claves de API, prioridades de redundancia (Ollama local, Gemini, OpenAI), y configura la auto-evolución en la nube.',
                            side: 'right',
                            align: 'start'
                        }
                    }
                ],
                onDestroyed: () => {
                    localStorage.setItem('silhouette_tour_completed', 'true');
                }
            });

            driverObj.drive();
        }, 1500);

        return () => clearTimeout(timer);
    }, []);

    return (
        <style>{`
            .driver-popover.driverjs-theme {
                background-color: #0b0f19 !important;
                color: #f3f4f6 !important;
                border: 1px solid rgba(6, 182, 212, 0.3) !important;
                border-radius: 16px !important;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8) !important;
                font-family: 'Inter', sans-serif !important;
                padding: 20px !important;
                max-width: 350px !important;
            }
            .driver-popover.driverjs-theme .driver-popover-title {
                color: #22d3ee !important;
                font-family: 'Outfit', sans-serif !important;
                font-size: 17px !important;
                font-weight: 600 !important;
                margin-bottom: 8px !important;
            }
            .driver-popover.driverjs-theme .driver-popover-description {
                color: #9ca3af !important;
                font-size: 13.5px !important;
                line-height: 1.6 !important;
                margin-bottom: 15px !important;
            }
            .driver-popover.driverjs-theme .driver-popover-footer {
                margin-top: 15px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
            }
            .driver-popover.driverjs-theme .driver-popover-btn {
                background-color: #1e293b !important;
                color: #e2e8f0 !important;
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                font-size: 12px !important;
                padding: 8px 16px !important;
                border-radius: 8px !important;
                transition: all 0.2s !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                outline: none !important;
            }
            .driver-popover.driverjs-theme .driver-popover-btn:hover {
                background-color: #334155 !important;
                color: #ffffff !important;
                border-color: rgba(34, 211, 238, 0.3) !important;
            }
            .driver-popover.driverjs-theme .driver-popover-next-btn {
                background: linear-gradient(135deg, #0891b2, #2563eb) !important;
                border: none !important;
                color: #ffffff !important;
            }
            .driver-popover.driverjs-theme .driver-popover-next-btn:hover {
                background: linear-gradient(135deg, #06b6d4, #3b82f6) !important;
                box-shadow: 0 0 10px rgba(6, 182, 212, 0.4) !important;
            }
            .driver-popover.driverjs-theme .driver-popover-progress-text {
                color: #64748b !important;
                font-size: 11px !important;
            }
            .driver-popover.driverjs-theme .driver-popover-arrow-side-left { border-left-color: #0b0f19 !important; }
            .driver-popover.driverjs-theme .driver-popover-arrow-side-right { border-right-color: #0b0f19 !important; }
            .driver-popover.driverjs-theme .driver-popover-arrow-side-top { border-top-color: #0b0f19 !important; }
            .driver-popover.driverjs-theme .driver-popover-arrow-side-bottom { border-bottom-color: #0b0f19 !important; }
        `}</style>
    );
};

export default OnboardingTour;
