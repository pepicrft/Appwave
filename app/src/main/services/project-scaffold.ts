import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface ScaffoldResult {
  success: boolean;
  projectPath: string;
  xcodePath: string | null;
  androidPath: string | null;
  error?: string;
}

/**
 * Scaffold a new project with Xcode and Android sub-projects
 */
export async function scaffoldNewProject(
  directory: string,
  projectName: string
): Promise<ScaffoldResult> {
  // Sanitize project name for use in code (remove spaces, special chars)
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9]/g, '');
  const projectPath = path.join(directory, projectName);

  try {
    // Create main project directory
    if (fs.existsSync(projectPath)) {
      return {
        success: false,
        projectPath,
        xcodePath: null,
        androidPath: null,
        error: `Directory already exists: ${projectPath}`,
      };
    }

    fs.mkdirSync(projectPath, { recursive: true });

    // Create apple and android directories
    const applePath = path.join(projectPath, 'apple');
    const androidPath = path.join(projectPath, 'android');
    fs.mkdirSync(applePath);
    fs.mkdirSync(androidPath);

    // Create AGENTS.md
    fs.writeFileSync(path.join(projectPath, 'AGENTS.md'), '');

    // Scaffold Xcode project
    const xcodeProjPath = await scaffoldXcodeProject(applePath, sanitizedName);

    // Scaffold Android project
    const androidProjPath = await scaffoldAndroidProject(androidPath, sanitizedName, projectName);

    return {
      success: true,
      projectPath,
      xcodePath: xcodeProjPath,
      androidPath: androidProjPath,
    };
  } catch (error) {
    return {
      success: false,
      projectPath,
      xcodePath: null,
      androidPath: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Scaffold a minimal SwiftUI Xcode project
 */
async function scaffoldXcodeProject(applePath: string, projectName: string): Promise<string> {
  const projPath = path.join(applePath, `${projectName}.xcodeproj`);
  const srcPath = path.join(applePath, projectName);

  // Create source directory
  fs.mkdirSync(srcPath);

  // Create SwiftUI App file
  const appContent = `import SwiftUI

@main
struct ${projectName}App: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`;
  fs.writeFileSync(path.join(srcPath, `${projectName}App.swift`), appContent);

  // Create ContentView
  const contentViewContent = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Image(systemName: "globe")
                .imageScale(.large)
                .foregroundStyle(.tint)
            Text("Hello, world!")
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
`;
  fs.writeFileSync(path.join(srcPath, 'ContentView.swift'), contentViewContent);

  // Create Assets.xcassets
  const assetsPath = path.join(srcPath, 'Assets.xcassets');
  fs.mkdirSync(assetsPath);
  fs.writeFileSync(
    path.join(assetsPath, 'Contents.json'),
    JSON.stringify(
      {
        info: {
          author: 'xcode',
          version: 1,
        },
      },
      null,
      2
    )
  );

  // Create AccentColor.colorset
  const accentColorPath = path.join(assetsPath, 'AccentColor.colorset');
  fs.mkdirSync(accentColorPath);
  fs.writeFileSync(
    path.join(accentColorPath, 'Contents.json'),
    JSON.stringify(
      {
        colors: [
          {
            idiom: 'universal',
          },
        ],
        info: {
          author: 'xcode',
          version: 1,
        },
      },
      null,
      2
    )
  );

  // Create AppIcon.appiconset
  const appIconPath = path.join(assetsPath, 'AppIcon.appiconset');
  fs.mkdirSync(appIconPath);
  fs.writeFileSync(
    path.join(appIconPath, 'Contents.json'),
    JSON.stringify(
      {
        images: [
          {
            idiom: 'universal',
            platform: 'ios',
            size: '1024x1024',
          },
        ],
        info: {
          author: 'xcode',
          version: 1,
        },
      },
      null,
      2
    )
  );

  // Create xcodeproj directory and project.pbxproj
  fs.mkdirSync(projPath);
  const pbxprojContent = generatePbxproj(projectName);
  fs.writeFileSync(path.join(projPath, 'project.pbxproj'), pbxprojContent);

  return projPath;
}

/**
 * Scaffold a minimal Android Kotlin project with Jetpack Compose
 */
async function scaffoldAndroidProject(
  androidPath: string,
  projectName: string,
  displayName: string
): Promise<string> {
  const packageName = `com.example.${projectName.toLowerCase()}`;
  const packagePath = packageName.replace(/\./g, '/');

  // Create directory structure
  const appPath = path.join(androidPath, 'app');
  const srcMainPath = path.join(appPath, 'src', 'main');
  const javaPath = path.join(srcMainPath, 'java', ...packagePath.split('/'));
  const resPath = path.join(srcMainPath, 'res');

  fs.mkdirSync(javaPath, { recursive: true });
  fs.mkdirSync(path.join(resPath, 'values'), { recursive: true });

  // Root build.gradle.kts
  const rootBuildGradle = `plugins {
    id("com.android.application") version "8.2.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.20" apply false
}
`;
  fs.writeFileSync(path.join(androidPath, 'build.gradle.kts'), rootBuildGradle);

  // settings.gradle.kts
  const settingsGradle = `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${displayName}"
include(":app")
`;
  fs.writeFileSync(path.join(androidPath, 'settings.gradle.kts'), settingsGradle);

  // gradle.properties
  const gradleProperties = `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`;
  fs.writeFileSync(path.join(androidPath, 'gradle.properties'), gradleProperties);

  // App build.gradle.kts
  const appBuildGradle = `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "${packageName}"
    compileSdk = 34

    defaultConfig {
        applicationId = "${packageName}"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.4"
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.6.2")
    implementation("androidx.activity:activity-compose:1.8.1")
    implementation(platform("androidx.compose:compose-bom:2023.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2023.10.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
`;
  fs.writeFileSync(path.join(appPath, 'build.gradle.kts'), appBuildGradle);

  // proguard-rules.pro
  fs.writeFileSync(path.join(appPath, 'proguard-rules.pro'), '# Add project specific ProGuard rules here.\n');

  // AndroidManifest.xml
  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <application
        android:allowBackup="true"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:fullBackupContent="@xml/backup_rules"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.${projectName}"
        tools:targetApi="31">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:label="@string/app_name"
            android:theme="@style/Theme.${projectName}">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
`;
  fs.writeFileSync(path.join(srcMainPath, 'AndroidManifest.xml'), manifest);

  // MainActivity.kt
  const mainActivity = `package ${packageName}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import ${packageName}.ui.theme.${projectName}Theme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ${projectName}Theme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    Greeting("World")
                }
            }
        }
    }
}

@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
    Text(
        text = "Hello, $name!",
        modifier = modifier
    )
}

@Preview(showBackground = true)
@Composable
fun GreetingPreview() {
    ${projectName}Theme {
        Greeting("World")
    }
}
`;
  fs.writeFileSync(path.join(javaPath, 'MainActivity.kt'), mainActivity);

  // Theme files
  const themePath = path.join(javaPath, 'ui', 'theme');
  fs.mkdirSync(themePath, { recursive: true });

  const colorKt = `package ${packageName}.ui.theme

import androidx.compose.ui.graphics.Color

val Purple80 = Color(0xFFD0BCFF)
val PurpleGrey80 = Color(0xFFCCC2DC)
val Pink80 = Color(0xFFEFB8C8)

val Purple40 = Color(0xFF6650a4)
val PurpleGrey40 = Color(0xFF625b71)
val Pink40 = Color(0xFF7D5260)
`;
  fs.writeFileSync(path.join(themePath, 'Color.kt'), colorKt);

  const themeKt = `package ${packageName}.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = Purple80,
    secondary = PurpleGrey80,
    tertiary = Pink80
)

private val LightColorScheme = lightColorScheme(
    primary = Purple40,
    secondary = PurpleGrey40,
    tertiary = Pink40
)

@Composable
fun ${projectName}Theme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }

        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.primary.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
`;
  fs.writeFileSync(path.join(themePath, 'Theme.kt'), themeKt);

  const typeKt = `package ${packageName}.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val Typography = Typography(
    bodyLarge = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.5.sp
    )
)
`;
  fs.writeFileSync(path.join(themePath, 'Type.kt'), typeKt);

  // Resource files
  const stringsXml = `<resources>
    <string name="app_name">${displayName}</string>
</resources>
`;
  fs.writeFileSync(path.join(resPath, 'values', 'strings.xml'), stringsXml);

  const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="purple_200">#FFBB86FC</color>
    <color name="purple_500">#FF6200EE</color>
    <color name="purple_700">#FF3700B3</color>
    <color name="teal_200">#FF03DAC5</color>
    <color name="teal_700">#FF018786</color>
    <color name="black">#FF000000</color>
    <color name="white">#FFFFFFFF</color>
</resources>
`;
  fs.writeFileSync(path.join(resPath, 'values', 'colors.xml'), colorsXml);

  const themesXml = `<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.${projectName}" parent="android:Theme.Material.Light.NoActionBar" />
</resources>
`;
  fs.writeFileSync(path.join(resPath, 'values', 'themes.xml'), themesXml);

  // Create xml directory for backup rules
  const xmlPath = path.join(resPath, 'xml');
  fs.mkdirSync(xmlPath, { recursive: true });

  const backupRules = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
</full-backup-content>
`;
  fs.writeFileSync(path.join(xmlPath, 'backup_rules.xml'), backupRules);

  const dataExtractionRules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
    </cloud-backup>
    <device-transfer>
    </device-transfer>
</data-extraction-rules>
`;
  fs.writeFileSync(path.join(xmlPath, 'data_extraction_rules.xml'), dataExtractionRules);

  // Create mipmap directories for launcher icons (placeholder)
  const mipmapPath = path.join(resPath, 'mipmap-hdpi');
  fs.mkdirSync(mipmapPath, { recursive: true });

  // Create gradle wrapper - download from official Gradle GitHub
  const gradleWrapperPath = path.join(androidPath, 'gradle', 'wrapper');
  fs.mkdirSync(gradleWrapperPath, { recursive: true });

  const gradleWrapperProperties = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.2-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;
  fs.writeFileSync(path.join(gradleWrapperPath, 'gradle-wrapper.properties'), gradleWrapperProperties);

  // Download gradle wrapper files from official Gradle repository
  const gradleVersion = '8.2';
  const gradleBaseUrl = `https://raw.githubusercontent.com/gradle/gradle/v${gradleVersion}`;

  try {
    // Download gradlew
    execSync(`curl -sL -o "${path.join(androidPath, 'gradlew')}" "${gradleBaseUrl}/gradlew"`, { stdio: 'pipe' });
    fs.chmodSync(path.join(androidPath, 'gradlew'), 0o755);

    // Download gradlew.bat
    execSync(`curl -sL -o "${path.join(androidPath, 'gradlew.bat')}" "${gradleBaseUrl}/gradlew.bat"`, { stdio: 'pipe' });

    // Download gradle-wrapper.jar
    execSync(`curl -sL -o "${path.join(gradleWrapperPath, 'gradle-wrapper.jar')}" "${gradleBaseUrl}/gradle/wrapper/gradle-wrapper.jar"`, { stdio: 'pipe' });
  } catch {
    console.warn('[scaffold] Could not download gradle wrapper files');
  }

  return androidPath;
}

/**
 * Generate a minimal project.pbxproj file for Xcode
 */
function generatePbxproj(projectName: string): string {
  // UUIDs for the project - these need to be unique
  const rootObjectId = generateUUID();
  const mainGroupId = generateUUID();
  const sourcesGroupId = generateUUID();
  const productsGroupId = generateUUID();
  const targetId = generateUUID();
  const buildConfigListProjectId = generateUUID();
  const buildConfigListTargetId = generateUUID();
  const debugConfigProjectId = generateUUID();
  const releaseConfigProjectId = generateUUID();
  const debugConfigTargetId = generateUUID();
  const releaseConfigTargetId = generateUUID();
  const appFileRefId = generateUUID();
  const sourcesBuildPhaseId = generateUUID();
  const frameworksBuildPhaseId = generateUUID();
  const resourcesBuildPhaseId = generateUUID();
  const appSwiftFileRefId = generateUUID();
  const contentViewFileRefId = generateUUID();
  const assetsFileRefId = generateUUID();
  const appSwiftBuildFileId = generateUUID();
  const contentViewBuildFileId = generateUUID();
  const assetsBuildFileId = generateUUID();

  return `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 56;
	objects = {

/* Begin PBXBuildFile section */
		${appSwiftBuildFileId} /* ${projectName}App.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${appSwiftFileRefId} /* ${projectName}App.swift */; };
		${contentViewBuildFileId} /* ContentView.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${contentViewFileRefId} /* ContentView.swift */; };
		${assetsBuildFileId} /* Assets.xcassets in Resources */ = {isa = PBXBuildFile; fileRef = ${assetsFileRefId} /* Assets.xcassets */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		${appFileRefId} /* ${projectName}.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = "${projectName}.app"; sourceTree = BUILT_PRODUCTS_DIR; };
		${appSwiftFileRefId} /* ${projectName}App.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "${projectName}App.swift"; sourceTree = "<group>"; };
		${contentViewFileRefId} /* ContentView.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "ContentView.swift"; sourceTree = "<group>"; };
		${assetsFileRefId} /* Assets.xcassets */ = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = "Assets.xcassets"; sourceTree = "<group>"; };
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
		${frameworksBuildPhaseId} /* Frameworks */ = {
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		${mainGroupId} = {
			isa = PBXGroup;
			children = (
				${sourcesGroupId} /* ${projectName} */,
				${productsGroupId} /* Products */,
			);
			sourceTree = "<group>";
		};
		${productsGroupId} /* Products */ = {
			isa = PBXGroup;
			children = (
				${appFileRefId} /* ${projectName}.app */,
			);
			name = Products;
			sourceTree = "<group>";
		};
		${sourcesGroupId} /* ${projectName} */ = {
			isa = PBXGroup;
			children = (
				${appSwiftFileRefId} /* ${projectName}App.swift */,
				${contentViewFileRefId} /* ContentView.swift */,
				${assetsFileRefId} /* Assets.xcassets */,
			);
			path = "${projectName}";
			sourceTree = "<group>";
		};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		${targetId} /* ${projectName} */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = ${buildConfigListTargetId} /* Build configuration list for PBXNativeTarget "${projectName}" */;
			buildPhases = (
				${sourcesBuildPhaseId} /* Sources */,
				${frameworksBuildPhaseId} /* Frameworks */,
				${resourcesBuildPhaseId} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = "${projectName}";
			productName = "${projectName}";
			productReference = ${appFileRefId} /* ${projectName}.app */;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		${rootObjectId} /* Project object */ = {
			isa = PBXProject;
			attributes = {
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 1500;
				LastUpgradeCheck = 1500;
				TargetAttributes = {
					${targetId} = {
						CreatedOnToolsVersion = 15.0;
					};
				};
			};
			buildConfigurationList = ${buildConfigListProjectId} /* Build configuration list for PBXProject "${projectName}" */;
			compatibilityVersion = "Xcode 14.0";
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
			);
			mainGroup = ${mainGroupId};
			productRefGroup = ${productsGroupId} /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				${targetId} /* ${projectName} */,
			);
		};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		${resourcesBuildPhaseId} /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				${assetsBuildFileId} /* Assets.xcassets in Resources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		${sourcesBuildPhaseId} /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				${contentViewBuildFileId} /* ContentView.swift in Sources */,
				${appSwiftBuildFileId} /* ${projectName}App.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
		${debugConfigProjectId} /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ALWAYS_SEARCH_USER_PATHS = NO;
				ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS = YES;
				CLANG_ANALYZER_NONNULL = YES;
				CLANG_ANALYZER_NUMBER_OBJECT_CONVERSION = YES_AGGRESSIVE;
				CLANG_CXX_LANGUAGE_STANDARD = "gnu++20";
				CLANG_ENABLE_MODULES = YES;
				CLANG_ENABLE_OBJC_ARC = YES;
				CLANG_ENABLE_OBJC_WEAK = YES;
				CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING = YES;
				CLANG_WARN_BOOL_CONVERSION = YES;
				CLANG_WARN_COMMA = YES;
				CLANG_WARN_CONSTANT_CONVERSION = YES;
				CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS = YES;
				CLANG_WARN_DIRECT_OBJC_ISA_USAGE = YES_ERROR;
				CLANG_WARN_DOCUMENTATION_COMMENTS = YES;
				CLANG_WARN_EMPTY_BODY = YES;
				CLANG_WARN_ENUM_CONVERSION = YES;
				CLANG_WARN_INFINITE_RECURSION = YES;
				CLANG_WARN_INT_CONVERSION = YES;
				CLANG_WARN_NON_LITERAL_NULL_CONVERSION = YES;
				CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF = YES;
				CLANG_WARN_OBJC_LITERAL_CONVERSION = YES;
				CLANG_WARN_OBJC_ROOT_CLASS = YES_ERROR;
				CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = YES;
				CLANG_WARN_RANGE_LOOP_ANALYSIS = YES;
				CLANG_WARN_STRICT_PROTOTYPES = YES;
				CLANG_WARN_SUSPICIOUS_MOVE = YES;
				CLANG_WARN_UNGUARDED_AVAILABILITY = YES_AGGRESSIVE;
				CLANG_WARN_UNREACHABLE_CODE = YES;
				CLANG_WARN__DUPLICATE_METHOD_MATCH = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				ENABLE_TESTABILITY = YES;
				ENABLE_USER_SCRIPT_SANDBOXING = YES;
				GCC_C_LANGUAGE_STANDARD = gnu17;
				GCC_DYNAMIC_NO_PIC = NO;
				GCC_NO_COMMON_BLOCKS = YES;
				GCC_OPTIMIZATION_LEVEL = 0;
				GCC_PREPROCESSOR_DEFINITIONS = (
					"DEBUG=1",
					"$(inherited)",
				);
				GCC_WARN_64_TO_32_BIT_CONVERSION = YES;
				GCC_WARN_ABOUT_RETURN_TYPE = YES_ERROR;
				GCC_WARN_UNDECLARED_SELECTOR = YES;
				GCC_WARN_UNINITIALIZED_AUTOS = YES_AGGRESSIVE;
				GCC_WARN_UNUSED_FUNCTION = YES;
				GCC_WARN_UNUSED_VARIABLE = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				LOCALIZATION_PREFERS_STRING_CATALOGS = YES;
				MTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;
				MTL_FAST_MATH = YES;
				ONLY_ACTIVE_ARCH = YES;
				SDKROOT = iphoneos;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG $(inherited)";
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
			};
			name = Debug;
		};
		${releaseConfigProjectId} /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ALWAYS_SEARCH_USER_PATHS = NO;
				ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS = YES;
				CLANG_ANALYZER_NONNULL = YES;
				CLANG_ANALYZER_NUMBER_OBJECT_CONVERSION = YES_AGGRESSIVE;
				CLANG_CXX_LANGUAGE_STANDARD = "gnu++20";
				CLANG_ENABLE_MODULES = YES;
				CLANG_ENABLE_OBJC_ARC = YES;
				CLANG_ENABLE_OBJC_WEAK = YES;
				CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING = YES;
				CLANG_WARN_BOOL_CONVERSION = YES;
				CLANG_WARN_COMMA = YES;
				CLANG_WARN_CONSTANT_CONVERSION = YES;
				CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS = YES;
				CLANG_WARN_DIRECT_OBJC_ISA_USAGE = YES_ERROR;
				CLANG_WARN_DOCUMENTATION_COMMENTS = YES;
				CLANG_WARN_EMPTY_BODY = YES;
				CLANG_WARN_ENUM_CONVERSION = YES;
				CLANG_WARN_INFINITE_RECURSION = YES;
				CLANG_WARN_INT_CONVERSION = YES;
				CLANG_WARN_NON_LITERAL_NULL_CONVERSION = YES;
				CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF = YES;
				CLANG_WARN_OBJC_LITERAL_CONVERSION = YES;
				CLANG_WARN_OBJC_ROOT_CLASS = YES_ERROR;
				CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = YES;
				CLANG_WARN_RANGE_LOOP_ANALYSIS = YES;
				CLANG_WARN_STRICT_PROTOTYPES = YES;
				CLANG_WARN_SUSPICIOUS_MOVE = YES;
				CLANG_WARN_UNGUARDED_AVAILABILITY = YES_AGGRESSIVE;
				CLANG_WARN_UNREACHABLE_CODE = YES;
				CLANG_WARN__DUPLICATE_METHOD_MATCH = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				ENABLE_NS_ASSERTIONS = NO;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				ENABLE_USER_SCRIPT_SANDBOXING = YES;
				GCC_C_LANGUAGE_STANDARD = gnu17;
				GCC_NO_COMMON_BLOCKS = YES;
				GCC_WARN_64_TO_32_BIT_CONVERSION = YES;
				GCC_WARN_ABOUT_RETURN_TYPE = YES_ERROR;
				GCC_WARN_UNDECLARED_SELECTOR = YES;
				GCC_WARN_UNINITIALIZED_AUTOS = YES_AGGRESSIVE;
				GCC_WARN_UNUSED_FUNCTION = YES;
				GCC_WARN_UNUSED_VARIABLE = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				LOCALIZATION_PREFERS_STRING_CATALOGS = YES;
				MTL_ENABLE_DEBUG_INFO = NO;
				MTL_FAST_MATH = YES;
				SDKROOT = iphoneos;
				SWIFT_COMPILATION_MODE = wholemodule;
				VALIDATE_PRODUCT = YES;
			};
			name = Release;
		};
		${debugConfigTargetId} /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_ASSET_PATHS = "";
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = YES;
				INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
				INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents = YES;
				INFOPLIST_KEY_UILaunchScreen_Generation = YES;
				INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
				);
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = "com.example.${projectName.toLowerCase()}";
				PRODUCT_NAME = "$(TARGET_NAME)";
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			};
			name = Debug;
		};
		${releaseConfigTargetId} /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_ASSET_PATHS = "";
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = YES;
				INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
				INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents = YES;
				INFOPLIST_KEY_UILaunchScreen_Generation = YES;
				INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
				);
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = "com.example.${projectName.toLowerCase()}";
				PRODUCT_NAME = "$(TARGET_NAME)";
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			};
			name = Release;
		};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		${buildConfigListProjectId} /* Build configuration list for PBXProject "${projectName}" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				${debugConfigProjectId} /* Debug */,
				${releaseConfigProjectId} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
		${buildConfigListTargetId} /* Build configuration list for PBXNativeTarget "${projectName}" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				${debugConfigTargetId} /* Debug */,
				${releaseConfigTargetId} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
/* End XCConfigurationList section */
	};
	rootObject = ${rootObjectId} /* Project object */;
}
`;
}

/**
 * Generate a UUID-like string for pbxproj
 */
function generateUUID(): string {
  const chars = '0123456789ABCDEF';
  let uuid = '';
  for (let i = 0; i < 24; i++) {
    uuid += chars[Math.floor(Math.random() * 16)];
  }
  return uuid;
}
