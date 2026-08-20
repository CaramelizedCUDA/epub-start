buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

subprojects {
    val androidProjectRoot = rootProject.projectDir.toPath().normalize()
    val subprojectRoot = project.projectDir.toPath().normalize()

    if (!subprojectRoot.startsWith(androidProjectRoot)) {
        layout.buildDirectory.set(
            rootProject.layout.buildDirectory.dir("external/${project.name}")
        )
    }
}

tasks.register("clean").configure {
    delete("build")
}

