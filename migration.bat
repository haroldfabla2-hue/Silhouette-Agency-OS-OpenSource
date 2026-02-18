@echo off
echo Starting Migration...
if not exist "Silhouette AGI" mkdir "Silhouette AGI"
xcopy server "Silhouette AGI\server" /E /I /Y
xcopy services "Silhouette AGI\services" /E /I /Y
xcopy components "Silhouette AGI\components" /E /I /Y
xcopy types "Silhouette AGI\types" /E /I /Y
xcopy silhouette "Silhouette AGI\silhouette" /E /I /Y
xcopy constants "Silhouette AGI\constants" /E /I /Y
xcopy hooks "Silhouette AGI\hooks" /E /I /Y
xcopy utils "Silhouette AGI\utils" /E /I /Y
xcopy universalprompts "Silhouette AGI\universalprompts" /E /I /Y
copy constants.ts "Silhouette AGI\"
copy App.tsx "Silhouette AGI\"
copy index.tsx "Silhouette AGI\"
copy index.html "Silhouette AGI\"
copy index.css "Silhouette AGI\"
copy vite.config.ts "Silhouette AGI\"
copy tsconfig.json "Silhouette AGI\"
copy tailwind.config.js "Silhouette AGI\"
copy postcss.config.js "Silhouette AGI\"
echo Migration Finished.
