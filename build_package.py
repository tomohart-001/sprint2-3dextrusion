
#!/usr/bin/env python3
"""
Build script for creating distributable EngineRoom package
"""
import os
import shutil
import subprocess
import sys

def clean_build():
    """Clean previous build artifacts"""
    dirs_to_clean = ['build', 'dist', '*.egg-info']
    for dir_pattern in dirs_to_clean:
        if os.path.exists(dir_pattern):
            shutil.rmtree(dir_pattern)
            print(f"Cleaned {dir_pattern}")

def build_package():
    """Build the package"""
    try:
        # Install build dependencies
        subprocess.run([sys.executable, "-m", "pip", "install", "build", "twine", "setuptools", "wheel"], check=True)
        
        # Build the package
        subprocess.run([sys.executable, "-m", "build"], check=True)
        print("✅ Package built successfully!")
        
        # List built files
        if os.path.exists('dist'):
            print("\n📦 Built packages:")
            for file in os.listdir('dist'):
                print(f"  - dist/{file}")
                
    except subprocess.CalledProcessError as e:
        print(f"❌ Build failed: {e}")
        return False
    
    return True

def main():
    """Main build process"""
    print("🏗️  Building EngineRoom package...")
    
    # Clean previous builds
    clean_build()
    
    # Build package
    if build_package():
        print("\n🎉 Package ready for distribution!")
        print("   You can install locally with: pip install dist/*.whl")
        print("   Or upload to PyPI with: twine upload dist/*")
    else:
        print("\n💥 Build failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()
