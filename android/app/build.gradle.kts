// Juntos on Android: a Trusted Web Activity, i.e. the web app (meet.jurisgames.com) opened full screen
// in the phone's own Chrome. Calls, camera and mic are Chrome's; this app holds no code of its own.
plugins {
    id("com.android.application")
}

android {
    namespace = "com.jurisgames.juntos"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.jurisgames.juntos"
        minSdk = 24
        targetSdk = 36
        versionCode = 4
        versionName = "1.1.2"
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
