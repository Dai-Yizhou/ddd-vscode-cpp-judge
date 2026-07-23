#include <iostream>
#include <vector>
using namespace std;

int main() {
    // 分配大内存，用于测试内存超限保护机制
    // 默认硬限制 4GB，软限制 512MB
    vector<long long> v;
    while (true) {
        v.push_back(0);
    }
    return 0;
}
