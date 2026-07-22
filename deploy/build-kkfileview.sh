#!/bin/bash

# kkFileView Docker 镜像自动构建脚本
# 自动克隆项目并构建

# ./deploy/build-kkfileview.sh

set -e  # 遇到错误立即退出

echo "========================================="
echo "kkFileView Docker 镜像自动构建脚本"
echo "========================================="

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 版本配置
KKFILEVIEW_VERSION="v4.4.0"
BASE_VERSION="4.4.0"
PROJECT_DIR="/tmp/file-online-preview"

# 检测操作系统
OS="$(uname -s)"
case "${OS}" in
    Linux*)     MACHINE=Linux;;
    Darwin*)   MACHINE=Mac;;
    *)          MACHINE="UNKNOWN:${OS}"
esac

echo -e "${YELLOW}检测到操作系统: ${MACHINE}${NC}"
echo ""

# 步骤 1: 检查并安装依赖
echo -e "${YELLOW}[1/5] 检查系统依赖...${NC}"

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}错误: 未找到 Docker,请先安装 Docker${NC}"
    echo "安装指南: https://docs.docker.com/engine/install/"
    exit 1
fi
echo -e "${GREEN}✓ Docker: $(docker --version)${NC}"

# 检查并安装 Git
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}未找到 Git,正在安装...${NC}"
    if [ "$MACHINE" = "Mac" ]; then
        if ! command -v brew &> /dev/null; then
            echo -e "${RED}错误: 未找到 Homebrew,请先安装 Homebrew${NC}"
            echo "安装命令: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
            exit 1
        fi
        brew install git
    else
        sudo apt-get update
        sudo apt-get install -y git
    fi
    echo -e "${GREEN}✓ Git 安装完成${NC}"
else
    echo -e "${GREEN}✓ Git: $(git --version)${NC}"
fi

# 检查并安装 Java 21
JAVA_VERSION=""
if command -v java &> /dev/null; then
    JAVA_VER_OUTPUT=$(java -version 2>&1 | head -n 1)
    echo -e "${GREEN}✓ 检测到 Java: $JAVA_VER_OUTPUT${NC}"
    # 提取 Java 版本号（兼容 Mac 和 Linux）
    if echo "$JAVA_VER_OUTPUT" | grep -q 'version "21'; then
        JAVA_VERSION="21"
    elif echo "$JAVA_VER_OUTPUT" | grep -q 'version "1.21'; then
        JAVA_VERSION="21"
    elif echo "$JAVA_VER_OUTPUT" | grep -q 'openjdk version "21'; then
        JAVA_VERSION="21"
    else
        # 尝试提取其他版本号
        JAVA_VERSION=$(echo "$JAVA_VER_OUTPUT" | sed -n 's/.*version "\([0-9]*\)\..*/\1/p' | head -n 1)
    fi
fi

# 检查 Java 版本是否为 21
if [ -z "$JAVA_VERSION" ] || [ "$JAVA_VERSION" != "21" ]; then
    echo -e "${YELLOW}需要 Java 21,当前版本: ${JAVA_VERSION:-未安装}${NC}"
    echo -e "${YELLOW}正在安装/配置 Java 21...${NC}"
    
    if [ "$MACHINE" = "Mac" ]; then
        if ! command -v brew &> /dev/null; then
            echo -e "${RED}错误: 未找到 Homebrew,请先安装 Homebrew${NC}"
            echo "安装命令: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
            exit 1
        fi
        # 使用 Homebrew 安装 OpenJDK 21
        echo -e "${YELLOW}正在使用 Homebrew 安装 OpenJDK 21...${NC}"
        brew install openjdk@21 || echo -e "${YELLOW}OpenJDK 21 可能已安装，继续...${NC}"
        
        # 尝试多种方式找到 Java 21 路径
        JAVA_HOME_CANDIDATES=(
            "$(/usr/libexec/java_home -v 21 2>/dev/null)"
            "/opt/homebrew/opt/openjdk@21"
            "/usr/local/opt/openjdk@21"
            "$(brew --prefix openjdk@21 2>/dev/null)"
        )
        
        JAVA_HOME_FOUND=""
        for candidate in "${JAVA_HOME_CANDIDATES[@]}"; do
            if [ -n "$candidate" ] && [ -d "$candidate" ]; then
                # 验证这是 JDK 而不是 JRE：必须包含 javac 编译器
                if [ -f "$candidate/bin/java" ] && [ -f "$candidate/bin/javac" ]; then
                    JAVA_HOME_FOUND="$candidate"
                    break
                fi
            fi
        done
        
        if [ -z "$JAVA_HOME_FOUND" ]; then
            echo -e "${RED}错误: 无法找到 Java 21 JDK 安装路径（需要包含 javac 编译器）${NC}"
            echo "请手动安装: brew install openjdk@21"
            echo "然后设置: export JAVA_HOME=\$(/usr/libexec/java_home -v 21)"
            echo ""
            echo "已找到的 Java 安装（但可能不是 JDK）:"
            for candidate in "${JAVA_HOME_CANDIDATES[@]}"; do
                if [ -n "$candidate" ] && [ -d "$candidate" ]; then
                    echo "  - $candidate (javac: $([ -f "$candidate/bin/javac" ] && echo "存在" || echo "不存在"))"
                fi
            done
            exit 1
        fi
        
        export JAVA_HOME="$JAVA_HOME_FOUND"
        export PATH="$JAVA_HOME/bin:$PATH"
        echo -e "${GREEN}✓ Java 21 JDK 安装完成, JAVA_HOME=$JAVA_HOME${NC}"
        
        # 验证 Java 和编译器版本
        echo -e "${YELLOW}验证 Java 和编译器版本...${NC}"
        "$JAVA_HOME/bin/java" -version 2>&1 | head -n 1
        if [ -f "$JAVA_HOME/bin/javac" ]; then
            echo -e "${GREEN}✓ javac 编译器存在: $("$JAVA_HOME/bin/javac" -version 2>&1)${NC}"
        else
            echo -e "${RED}错误: javac 编译器不存在于 $JAVA_HOME/bin${NC}"
            exit 1
        fi
    else
        sudo apt-get update
        sudo apt-get install -y openjdk-21-jdk
        export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
        export PATH="$JAVA_HOME/bin:$PATH"
        echo -e "${GREEN}✓ Java 21 安装完成${NC}"
    fi
else
    echo -e "${GREEN}✓ Java 版本正确: 21${NC}"
    # 确保 JAVA_HOME 已设置并指向 JDK（包含 javac）
    if [ -z "$JAVA_HOME" ] || [ ! -f "$JAVA_HOME/bin/javac" ]; then
        if [ "$MACHINE" = "Mac" ]; then
            JAVA_HOME_CANDIDATE=$(/usr/libexec/java_home -v 21 2>/dev/null || echo "")
            # 验证这是 JDK 而不是 JRE
            if [ -n "$JAVA_HOME_CANDIDATE" ] && [ -f "$JAVA_HOME_CANDIDATE/bin/javac" ]; then
                export JAVA_HOME="$JAVA_HOME_CANDIDATE"
            else
                # 尝试其他路径
                for path in "/opt/homebrew/opt/openjdk@21" "/usr/local/opt/openjdk@21" "$(brew --prefix openjdk@21 2>/dev/null)"; do
                    if [ -n "$path" ] && [ -d "$path" ] && [ -f "$path/bin/javac" ]; then
                        export JAVA_HOME="$path"
                        break
                    fi
                done
            fi
        else
            JAVA_HOME_CANDIDATE=$(readlink -f /usr/bin/java | sed "s:bin/java::")
            if [ -n "$JAVA_HOME_CANDIDATE" ] && [ -f "$JAVA_HOME_CANDIDATE/bin/javac" ]; then
                export JAVA_HOME="$JAVA_HOME_CANDIDATE"
            fi
        fi
        if [ -n "$JAVA_HOME" ] && [ -f "$JAVA_HOME/bin/javac" ]; then
            echo -e "${GREEN}✓ 设置 JAVA_HOME=$JAVA_HOME (JDK)${NC}"
        else
            echo -e "${YELLOW}警告: 无法自动找到 Java 21 JDK，请手动设置 JAVA_HOME${NC}"
        fi
    fi
    
    # 验证 JAVA_HOME 指向的是 JDK
    if [ -n "$JAVA_HOME" ] && [ ! -f "$JAVA_HOME/bin/javac" ]; then
        echo -e "${RED}错误: JAVA_HOME=$JAVA_HOME 指向的不是 JDK（缺少 javac 编译器）${NC}"
        echo "请确保 JAVA_HOME 指向 JDK 而不是 JRE"
        exit 1
    fi
fi

# 验证 Java 版本和 JDK
if [ -n "$JAVA_HOME" ]; then
    JAVA_VER_CHECK=$("$JAVA_HOME/bin/java" -version 2>&1 | head -n 1)
    echo -e "${GREEN}当前使用的 Java: $JAVA_VER_CHECK${NC}"
    echo -e "${GREEN}JAVA_HOME: $JAVA_HOME${NC}"
    
    # 验证这是 JDK 而不是 JRE
    if [ -f "$JAVA_HOME/bin/javac" ]; then
        JAVAC_VER=$("$JAVA_HOME/bin/javac" -version 2>&1)
        echo -e "${GREEN}✓ JDK 编译器: $JAVAC_VER${NC}"
    else
        echo -e "${RED}错误: JAVA_HOME 指向的不是 JDK（缺少 javac 编译器）${NC}"
        echo "请确保安装的是 JDK 而不是 JRE"
        exit 1
    fi
else
    JAVA_VER_CHECK=$(java -version 2>&1 | head -n 1)
    echo -e "${GREEN}当前使用的 Java: $JAVA_VER_CHECK${NC}"
    echo -e "${YELLOW}警告: JAVA_HOME 未设置，可能无法正确编译${NC}"
fi

# 检查并安装 Maven
if ! command -v mvn &> /dev/null; then
    echo -e "${YELLOW}未找到 Maven,正在安装...${NC}"
    if [ "$MACHINE" = "Mac" ]; then
        brew install maven
    else
        sudo apt-get update
        sudo apt-get install -y maven
    fi
    echo -e "${GREEN}✓ Maven 安装完成${NC}"
else
    echo -e "${GREEN}✓ Maven: $(mvn -version | head -n 1)${NC}"
fi

# 验证 Maven 使用的 Java 版本
echo -e "${YELLOW}验证 Maven 使用的 Java 版本...${NC}"
MAVEN_JAVA=$(mvn -version | grep "Java version" || echo "")
echo -e "${GREEN}$MAVEN_JAVA${NC}"

echo ""

# 步骤 2: 克隆项目
echo -e "${YELLOW}[2/5] 克隆项目到 ${PROJECT_DIR}...${NC}"
if [ -d "$PROJECT_DIR" ] && [ -d "$PROJECT_DIR/.git" ]; then
    echo -e "${GREEN}✓ 项目目录已存在，跳过克隆${NC}"
    cd "$PROJECT_DIR"
else
    if [ -d "$PROJECT_DIR" ]; then
        echo "项目目录已存在但不是 git 仓库，删除旧目录..."
        rm -rf "$PROJECT_DIR"
    fi
    git clone https://gitee.com/kekingcn/file-online-preview.git "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    echo -e "${GREEN}✓ 项目克隆完成${NC}"
fi
echo ""

# 步骤 3: Maven 打包
echo -e "${YELLOW}[3/5] Maven 编译打包...${NC}"

# 确保 JAVA_HOME 已设置并在 PATH 中，且指向 JDK
if [ -n "$JAVA_HOME" ]; then
    # 再次验证这是 JDK
    if [ ! -f "$JAVA_HOME/bin/javac" ]; then
        echo -e "${RED}错误: JAVA_HOME=$JAVA_HOME 指向的不是 JDK（缺少 javac 编译器）${NC}"
        echo "Maven 需要 JDK 才能编译，请确保 JAVA_HOME 指向 JDK 安装目录"
        exit 1
    fi
    
    export PATH="$JAVA_HOME/bin:$PATH"
    export JAVA_HOME="$JAVA_HOME"  # 确保 Maven 使用这个 JAVA_HOME
    echo -e "${GREEN}使用 JAVA_HOME: $JAVA_HOME (JDK)${NC}"
    
    # 验证 Maven 使用的 Java 版本
    echo -e "${YELLOW}Maven 将使用的 Java 版本:${NC}"
    mvn -version | grep -E "(Java version|Java home)" || echo ""
    
    # 验证 Maven 能找到编译器
    if ! "$JAVA_HOME/bin/javac" -version &>/dev/null; then
        echo -e "${RED}错误: 无法执行 javac 编译器${NC}"
        exit 1
    fi
else
    echo -e "${RED}错误: JAVA_HOME 未设置，无法编译${NC}"
    echo "请设置 JAVA_HOME 环境变量指向 JDK 安装目录"
    exit 1
fi

# 运行 Maven 打包，如果 JAVA_HOME 已设置，Maven 会自动使用它
mvn clean package -DskipTests
echo -e "${GREEN}✓ Maven 打包完成${NC}"
echo ""

# 步骤 4: 构建基础镜像
echo -e "${YELLOW}[4/5] 构建基础 Docker 镜像 (keking/kkfileview-base:${BASE_VERSION})...${NC}"
cd docker/kkfileview-base/
docker build -t keking/kkfileview-base:${BASE_VERSION} .
cd ../..
echo -e "${GREEN}✓ 基础镜像构建完成${NC}"
echo ""

# 步骤 5: 构建最终镜像
echo -e "${YELLOW}[5/5] 构建最终 Docker 镜像 (keking/kkfileview:${KKFILEVIEW_VERSION})...${NC}"
docker build -t keking/kkfileview:${KKFILEVIEW_VERSION} .
echo -e "${GREEN}✓ 最终镜像构建完成${NC}"
echo ""

# 完成
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}✓ 构建完成!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "镜像列表:"
docker images | grep kkfileview | head -n 10

echo ""
echo "项目位置:"
echo -e "  ${YELLOW}${PROJECT_DIR}${NC}"
echo ""
echo "运行容器:"
echo -e "  ${YELLOW}docker run -d -p 8012:8012 keking/kkfileview:${KKFILEVIEW_VERSION}${NC}"
echo ""
echo "访问地址:"
echo -e "  ${YELLOW}http://localhost:8012${NC}"
echo ""
echo "清理临时文件(可选):"
echo -e "  ${YELLOW}rm -rf ${PROJECT_DIR}${NC}"
echo ""
