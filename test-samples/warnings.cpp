#include <iostream>
using namespace std;

int main() {
    int x;
    // 未初始化变量使用，触发 -Wuninitialized 警告
    cout << x << endl;

    // 隐式类型转换，触发 -Wconversion 警告
    double d = 3.14;
    int y = d;
    cout << y << endl;

    return 0;
}
